/**
 * DatabasePanel
 *
 * Settings → Database. Shows the current storage backend, lets alpha users
 * dry-run the PGLite → SQLite migration (zero-risk: never touches the live
 * database), and stages the eventual "Migrate" CTA.
 *
 * IPC contract (see packages/electron/src/main/ipc/MigrationHandlers.ts):
 *   - db:migration:get-status   -> { activeBackend, pgliteDirExists, sqliteDirExists, migratedDirs, runningDryRun }
 *   - db:migration:dry-run      -> { success, result: DryRunResult } | { success: false, error }
 *   - db:migration:start        -> kicks off real migration; gated behind translator work
 *   - db:migration:rollback     -> restores pglite-db/ from a preserved sibling
 *   - db:migration:progress/phase/complete/failed (events) -> live updates
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime';

type Backend = 'pglite' | 'sqlite';

interface MigrationStatus {
  activeBackend: Backend;
  pgliteDirExists: boolean;
  sqliteDirExists: boolean;
  migratedDirs: string[];
  running: boolean;
  runningDryRun: boolean;
}

interface DryRunPerTable {
  name: string;
  sourceCount: number;
  targetCount: number;
  durationMs: number;
}

interface DryRunResult {
  summary: {
    tablesCopied: string[];
    perTable: DryRunPerTable[];
    totalRowsCopied: number;
    durationMs: number;
    foreignKeyViolations: number;
    integrityCheck: string;
  };
  dryRunDir: string;
  sqliteFileBytes: number;
  pgliteDirBytes: number;
}

interface PhaseEvent {
  phase: string;
  info?: ProgressEvent;
}

interface ProgressEvent {
  phase?: string;
  table?: string;
  currentTable?: string;
  rowsCopied?: number;
  rowsTotal?: number;
  rowsExpected?: number;
  totalRowsCopied?: number;
  tableRowsCopied?: number;
  tableRowsExpected?: number;
  tablesCompleted?: number;
  tablesTotal?: number;
  percentOfTotal?: number;
  elapsedMs?: number;
}

interface PreflightResult {
  ok: boolean;
  reason?: string;
  pgliteDirBytes: number;
  freeBytes: number;
  requiredBytes: number;
}

interface MigrationSummary {
  totalRowsCopied: number;
  tablesCopied: Array<{ name: string; rows: number }>;
  durationMs: number;
  integrityCheck: string;
  foreignKeyViolations: number;
  spotCheckCount: number;
}

interface MigrationFailure {
  phase: string;
  message: string;
  stack?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(0);
  return `${mins} min ${secs} s`;
}

export function DatabasePanel(): React.ReactElement {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [dryRunRunning, setDryRunRunning] = useState(false);
  const [phase, setPhase] = useState<PhaseEvent | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationSummary, setMigrationSummary] = useState<MigrationSummary | null>(null);
  const [migrationFailure, setMigrationFailure] = useState<MigrationFailure | null>(null);

  const loadStatus = useCallback(async () => {
    if (!window.electronAPI) return;
    try {
      const resp = (await window.electronAPI.invoke('db:migration:get-status')) as
        | (MigrationStatus & { success: true })
        | { success: false; error: string };
      if (!resp.success) {
        setStatusError(resp.error);
        return;
      }
      setStatusError(null);
      setStatus({
        activeBackend: resp.activeBackend,
        pgliteDirExists: resp.pgliteDirExists,
        sqliteDirExists: resp.sqliteDirExists,
        migratedDirs: resp.migratedDirs,
        running: resp.running,
        runningDryRun: resp.runningDryRun,
      });
    } catch (err) {
      setStatusError(String((err as Error).message ?? err));
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Subscribe to the migration event channels so the dry-run flow shows
  // live progress. The renderer-side IPC listener pattern is documented in
  // /docs/IPC_LISTENERS.md; we register here and clean up on unmount.
  useEffect(() => {
    if (!window.electronAPI) return;
    const onPhase = (_: unknown, payload: PhaseEvent) => setPhase(payload);
    const onProgress = (_: unknown, payload: ProgressEvent) => setProgress(payload);
    const onComplete = (_: unknown, payload: MigrationSummary) => {
      setMigrationRunning(false);
      setMigrationFailure(null);
      setMigrationSummary(payload);
    };
    const onFailed = (_: unknown, payload: MigrationFailure) => {
      setMigrationRunning(false);
      setMigrationFailure(payload);
    };
    window.electronAPI.on('db:migration:phase', onPhase);
    window.electronAPI.on('db:migration:progress', onProgress);
    window.electronAPI.on('db:migration:complete', onComplete);
    window.electronAPI.on('db:migration:failed', onFailed);
    return () => {
      window.electronAPI?.off?.('db:migration:phase', onPhase);
      window.electronAPI?.off?.('db:migration:progress', onProgress);
      window.electronAPI?.off?.('db:migration:complete', onComplete);
      window.electronAPI?.off?.('db:migration:failed', onFailed);
    };
  }, []);

  const startDryRun = useCallback(async () => {
    if (!window.electronAPI || dryRunRunning) return;
    setDryRunRunning(true);
    setDryRunError(null);
    setDryRunResult(null);
    setPhase(null);
    setProgress(null);
    try {
      const resp = (await window.electronAPI.invoke('db:migration:dry-run')) as
        | { success: true; result: DryRunResult }
        | { success: false; error: string };
      if (!resp.success) {
        setDryRunError(resp.error);
      } else {
        setDryRunResult(resp.result);
      }
    } catch (err) {
      setDryRunError(String((err as Error).message ?? err));
    } finally {
      setDryRunRunning(false);
      void loadStatus();
    }
  }, [dryRunRunning, loadStatus]);

  const rollback = useCallback(async () => {
    if (!window.electronAPI) return;
    if (!window.confirm('Restore the preserved PGLite database? You will lose any data created since the migration. Requires a relaunch.')) {
      return;
    }
    const resp = (await window.electronAPI.invoke('db:migration:rollback')) as
      | { success: true; restoredFrom: string }
      | { success: false; error: string };
    if (!resp.success) {
      window.alert(`Rollback failed: ${resp.error}`);
    } else {
      window.alert(`Restored from ${resp.restoredFrom}. Please relaunch Nimbalyst.`);
    }
    void loadStatus();
  }, [loadStatus]);

  const openMigrationModal = useCallback(async () => {
    if (!window.electronAPI) return;
    setShowMigrationModal(true);
    setPreflight(null);
    setPreflightError(null);
    setMigrationFailure(null);
    setMigrationSummary(null);
    setPhase(null);
    setProgress(null);
    try {
      const resp = (await window.electronAPI.invoke('db:migration:preflight')) as
        | ({ success: true } & PreflightResult)
        | { success: false; error: string };
      if (!resp.success) {
        setPreflightError(resp.error);
        return;
      }
      setPreflight(resp);
    } catch (err) {
      setPreflightError(String((err as Error).message ?? err));
    }
  }, []);

  const startMigration = useCallback(async () => {
    if (!window.electronAPI || migrationRunning || !preflight?.ok) return;
    setMigrationRunning(true);
    setMigrationFailure(null);
    setMigrationSummary(null);
    try {
      const resp = (await window.electronAPI.invoke('db:migration:start')) as
        | { success: true; summary: MigrationSummary }
        | { success: false; error: string };
      if (!resp.success) {
        setMigrationRunning(false);
        setMigrationFailure({ phase: phase?.phase ?? 'start', message: resp.error });
      } else {
        setMigrationSummary(resp.summary);
        setMigrationRunning(false);
        void loadStatus();
      }
    } catch (err) {
      setMigrationRunning(false);
      setMigrationFailure({
        phase: phase?.phase ?? 'start',
        message: String((err as Error).message ?? err),
      });
    }
  }, [loadStatus, migrationRunning, phase?.phase, preflight?.ok]);

  const copyDiagnosticInfo = useCallback(async () => {
    const diagnostic = JSON.stringify({
      preflight,
      phase,
      progress,
      failure: migrationFailure,
    }, null, 2);
    await navigator.clipboard.writeText(diagnostic);
  }, [migrationFailure, phase, preflight, progress]);

  const backendLabel = useMemo(() => {
    if (!status) return 'Loading...';
    return status.activeBackend === 'pglite' ? 'PGLite (current)' : 'SQLite (new)';
  }, [status]);

  return (
    <div className="provider-panel flex flex-col">
      <div className="provider-panel-header mb-6 pb-4 border-b border-[var(--nim-border)]">
        <h3 className="provider-panel-title text-xl font-semibold leading-tight mb-2 text-[var(--nim-text)]">
          Database Storage
        </h3>
        <p className="provider-panel-description text-sm leading-relaxed text-[var(--nim-text-muted)]">
          Local storage engine for sessions, trackers, and document history.
          PGLite is the current default; a faster SQLite backend is in alpha.
        </p>
      </div>

      {/* Current backend section ----------------------------------------- */}
      <div className="provider-panel-section mb-6">
        <h4 className="provider-panel-section-title text-base font-semibold mb-2 text-[var(--nim-text)]">
          Active backend
        </h4>
        {statusError ? (
          <div className="p-3 rounded-md bg-[rgba(220,38,38,0.1)] border border-[rgba(220,38,38,0.3)] text-sm text-[var(--nim-text)]">
            Failed to read status: {statusError}
          </div>
        ) : (
          <div className="setting-item py-2 flex items-center justify-between gap-4 nim-database-status">
            <div className="flex flex-col gap-0 min-w-0">
              <span className="setting-name text-sm font-medium text-[var(--nim-text)]">
                {backendLabel}
              </span>
              <span className="setting-description text-xs leading-snug text-[var(--nim-text-muted)]">
                {status?.pgliteDirExists && status?.sqliteDirExists
                  ? 'Both pglite-db/ and sqlite-db/ exist on disk.'
                  : status?.pgliteDirExists
                    ? 'pglite-db/ on disk; sqlite-db/ not yet created.'
                    : status?.sqliteDirExists
                      ? 'sqlite-db/ on disk; legacy pglite-db/ absent.'
                      : 'No database directory present yet.'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Dry run section ------------------------------------------------- */}
      <div className="provider-panel-section mb-6">
        <h4 className="provider-panel-section-title text-base font-semibold mb-2 text-[var(--nim-text)]">
          Test the SQLite migration (dry run)
        </h4>
        <p className="provider-panel-hint text-sm text-[var(--nim-text-muted)] mb-3">
          Copies your data into a throwaway SQLite database alongside the live one,
          reports row counts and integrity, then deletes the temporary copy.
          Your real PGLite database is never touched. Safe to run any time.
        </p>

        <button
          type="button"
          onClick={startDryRun}
          disabled={dryRunRunning || !status}
          className="nim-database-dry-run-button setting-button inline-flex items-center gap-2 py-1.5 px-3 rounded-md text-sm font-medium bg-[var(--nim-primary)] text-white border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--nim-primary-hover)]"
        >
          <MaterialSymbol icon={dryRunRunning ? 'sync' : 'play_arrow'} size={16} />
          {dryRunRunning ? 'Running dry run...' : 'Run dry-run migration'}
        </button>

        {(dryRunRunning && (phase || progress)) && (
          <div className="mt-3 p-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] text-xs nim-database-dry-run-progress">
            {phase && (
              <div className="text-[var(--nim-text)]">
                <strong>Phase:</strong> {phase.phase}
                {phase.info?.currentTable ? ` - ${phase.info.currentTable}` : ''}
              </div>
            )}
            {progress && (
              <div className="text-[var(--nim-text-muted)] mt-1">
                {progress.table ? `${progress.table}: ` : ''}
                {progress.rowsCopied ?? 0}
                {progress.rowsTotal ? ` / ${progress.rowsTotal}` : ''}
                {progress.totalRowsCopied !== undefined
                  ? ` (${progress.totalRowsCopied} total)`
                  : ''}
              </div>
            )}
          </div>
        )}

        {dryRunError && (
          <div className="mt-3 p-3 rounded-md bg-[rgba(220,38,38,0.1)] border border-[rgba(220,38,38,0.3)] text-sm text-[var(--nim-text)] nim-database-dry-run-error">
            Dry run failed: {dryRunError}
          </div>
        )}

        {dryRunResult && (
          <div className="mt-3 nim-database-dry-run-result">
            <DryRunResultCard result={dryRunResult} />
          </div>
        )}
      </div>

      {/* Migrate (gated) section ----------------------------------------- */}
      <div className="provider-panel-section mb-6">
        <h4 className="provider-panel-section-title text-base font-semibold mb-2 text-[var(--nim-text)]">
          Migrate to SQLite
        </h4>
        <p className="provider-panel-hint text-sm text-[var(--nim-text-muted)] mb-3">
          Moves all your data from PGLite to SQLite. The original PGLite directory
          is preserved at <code className="px-1 py-0.5 rounded bg-[var(--nim-bg-tertiary)] text-xs">pglite-db.migrated-&lt;timestamp&gt;/</code> and
          can be restored from this panel.
        </p>

        <button
          type="button"
          onClick={() => { void openMigrationModal(); }}
          disabled={!status || status.activeBackend !== 'pglite'}
          className="setting-button inline-flex items-center gap-2 py-1.5 px-3 rounded-md text-sm font-medium bg-[var(--nim-primary)] text-white border-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--nim-primary-hover)]"
        >
          <MaterialSymbol icon="upgrade" size={16} />
          Migrate to SQLite
        </button>
      </div>

      {/* Rollback section (only visible if a migrated dir exists) -------- */}
      {status && status.migratedDirs.length > 0 && (
        <div className="provider-panel-section mb-6">
          <h4 className="provider-panel-section-title text-base font-semibold mb-2 text-[var(--nim-text)]">
            Restore previous PGLite database
          </h4>
          <p className="provider-panel-hint text-sm text-[var(--nim-text-muted)] mb-3">
            Preserved snapshots on disk: {status.migratedDirs.length}. The most
            recent will be used.
          </p>
          <button
            type="button"
            onClick={rollback}
            className="setting-button inline-flex items-center gap-2 py-1.5 px-3 rounded-md text-sm font-medium bg-[var(--nim-bg-secondary)] text-[var(--nim-text)] border border-[var(--nim-border)] cursor-pointer hover:bg-[var(--nim-hover)]"
          >
            <MaterialSymbol icon="restore" size={16} />
            Restore from preserved PGLite
          </button>
        </div>
      )}

      {showMigrationModal && (
        <MigrationModal
          preflight={preflight}
          preflightError={preflightError}
          phase={phase}
          progress={progress}
          running={migrationRunning}
          summary={migrationSummary}
          failure={migrationFailure}
          onClose={() => {
            if (migrationRunning) return;
            setShowMigrationModal(false);
            void loadStatus();
          }}
          onStart={() => { void startMigration(); }}
          onCopyDiagnostic={() => { void copyDiagnosticInfo(); }}
        />
      )}
    </div>
  );
}

function DryRunResultCard({ result }: { result: DryRunResult }): React.ReactElement {
  const sizeChange = result.sqliteFileBytes - result.pgliteDirBytes;
  const sizeChangePct = result.pgliteDirBytes > 0
    ? ((sizeChange / result.pgliteDirBytes) * 100).toFixed(1)
    : '0';
  return (
    <div className="p-3 rounded-md bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]">
      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        <Stat label="Rows copied" value={result.summary.totalRowsCopied.toLocaleString()} />
        <Stat label="Tables" value={String(result.summary.tablesCopied.length)} />
        <Stat label="Duration" value={formatDuration(result.summary.durationMs)} />
        <Stat label="FK violations" value={String(result.summary.foreignKeyViolations)} ok={result.summary.foreignKeyViolations === 0} />
        <Stat label="Integrity" value={result.summary.integrityCheck} ok={result.summary.integrityCheck === 'ok'} />
        <Stat
          label="On-disk"
          value={`${formatBytes(result.sqliteFileBytes)} vs ${formatBytes(result.pgliteDirBytes)} (${sizeChange >= 0 ? '+' : ''}${sizeChangePct}%)`}
        />
      </div>

      <details className="mt-2 nim-database-dry-run-per-table">
        <summary className="cursor-pointer text-xs text-[var(--nim-text-muted)] hover:text-[var(--nim-text)]">
          Per-table breakdown ({result.summary.perTable.length} tables)
        </summary>
        <table className="w-full mt-2 text-xs">
          <thead>
            <tr className="text-left text-[var(--nim-text-muted)] border-b border-[var(--nim-border)]">
              <th className="py-1 pr-2">Table</th>
              <th className="py-1 pr-2 text-right">Source rows</th>
              <th className="py-1 pr-2 text-right">Target rows</th>
              <th className="py-1 text-right">Time</th>
            </tr>
          </thead>
          <tbody>
            {result.summary.perTable.map((t) => (
              <tr key={t.name} className="border-b border-[var(--nim-border)] last:border-b-0">
                <td className="py-1 pr-2 text-[var(--nim-text)] font-mono">{t.name}</td>
                <td className="py-1 pr-2 text-right text-[var(--nim-text)]">{t.sourceCount.toLocaleString()}</td>
                <td className={`py-1 pr-2 text-right ${t.sourceCount === t.targetCount ? 'text-[var(--nim-text)]' : 'text-[var(--nim-error)]'}`}>
                  {t.targetCount.toLocaleString()}
                </td>
                <td className="py-1 text-right text-[var(--nim-text-muted)]">{formatDuration(t.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }): React.ReactElement {
  const colorClass = ok === false ? 'text-[var(--nim-error)]' : 'text-[var(--nim-text)]';
  return (
    <div className="flex flex-col gap-0">
      <span className="text-xs text-[var(--nim-text-muted)]">{label}</span>
      <span className={`text-sm font-medium ${colorClass}`}>{value}</span>
    </div>
  );
}

function MigrationModal(props: {
  preflight: PreflightResult | null;
  preflightError: string | null;
  phase: PhaseEvent | null;
  progress: ProgressEvent | null;
  running: boolean;
  summary: MigrationSummary | null;
  failure: MigrationFailure | null;
  onClose: () => void;
  onStart: () => void;
  onCopyDiagnostic: () => void;
}): React.ReactElement {
  const { preflight, preflightError, phase, progress, running, summary, failure, onClose, onStart, onCopyDiagnostic } = props;
  const currentTable = progress?.currentTable ?? progress?.table ?? 'Preparing';
  const isVerifying = phase?.phase?.startsWith('verifying') ?? false;
  const isCutover = phase?.phase === 'finalizing';

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-2xl rounded-xl border border-[var(--nim-border)] bg-[var(--nim-bg-primary)] p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h4 className="text-lg font-semibold text-[var(--nim-text)]">Migrate to SQLite</h4>
            <p className="mt-1 text-sm text-[var(--nim-text-muted)]">
              This runs in one uninterrupted flow and preserves the original PGLite directory for rollback.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="rounded-md px-2 py-1 text-sm text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-secondary)] disabled:opacity-40"
          >
            Close
          </button>
        </div>

        {preflightError && (
          <div className="rounded-md border border-[rgba(220,38,38,0.3)] bg-[rgba(220,38,38,0.1)] p-3 text-sm text-[var(--nim-text)]">
            Pre-flight failed: {preflightError}
          </div>
        )}

        {!running && !summary && !failure && preflight && (
          <div className="space-y-4">
            <div className="rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-4 text-sm">
              <div className="mb-2 font-medium text-[var(--nim-text)]">Pre-flight</div>
              <div className="space-y-2 text-[var(--nim-text-muted)]">
                <div>Disk space: {formatBytes(preflight.freeBytes)} free / {formatBytes(preflight.requiredBytes)} required {preflight.ok ? 'OK' : 'FAIL'}</div>
                <div>PGLite size: {formatBytes(preflight.pgliteDirBytes)}</div>
                {!preflight.ok && preflight.reason && <div className="text-[var(--nim-error)]">{preflight.reason}</div>}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-md border border-[var(--nim-border)] px-3 py-2 text-sm text-[var(--nim-text)]">
                Cancel
              </button>
              <button
                type="button"
                onClick={onStart}
                disabled={!preflight.ok}
                className="rounded-md bg-[var(--nim-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Start migration
              </button>
            </div>
          </div>
        )}

        {running && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-[var(--nim-text)]">
                {isCutover ? 'Switching to the new database' : isVerifying ? 'Verifying the migration' : 'Migrating your data'}
              </div>
              <div className="mt-1 text-sm text-[var(--nim-text-muted)]">
                {isCutover ? 'Preserving the previous PGLite directory and flipping the active backend.' : isVerifying ? `Phase: ${phase?.phase}` : `${currentTable}: ${progress?.tableRowsCopied ?? 0} / ${progress?.tableRowsExpected ?? 0}`}
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-[var(--nim-bg-secondary)]">
                <div className="h-full bg-[var(--nim-primary)]" style={{ width: `${progress?.percentOfTotal ?? 0}%` }} />
              </div>
              <div className="flex justify-between text-xs text-[var(--nim-text-muted)]">
                <span>Tables {progress?.tablesCompleted ?? 0} / {progress?.tablesTotal ?? 0}</span>
                <span>{Math.round(progress?.percentOfTotal ?? 0)}%</span>
              </div>
              <div className="text-xs text-[var(--nim-text-muted)]">
                Rows transferred: {(progress?.totalRowsCopied ?? 0).toLocaleString()} · Elapsed: {formatDuration(progress?.elapsedMs ?? 0)}
              </div>
            </div>
          </div>
        )}

        {summary && (
          <div className="space-y-4">
            <div className="rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-4">
              <div className="text-sm font-medium text-[var(--nim-text)]">Migration complete</div>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                <Stat label="Rows transferred" value={summary.totalRowsCopied.toLocaleString()} />
                <Stat label="Tables migrated" value={String(summary.tablesCopied.length)} />
                <Stat label="Duration" value={formatDuration(summary.durationMs)} />
                <Stat label="Integrity" value={summary.integrityCheck} ok={summary.integrityCheck === 'ok'} />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="rounded-md bg-[var(--nim-primary)] px-3 py-2 text-sm font-medium text-white">
                Continue
              </button>
            </div>
          </div>
        )}

        {failure && (
          <div className="space-y-4">
            <div className="rounded-md border border-[rgba(220,38,38,0.3)] bg-[rgba(220,38,38,0.1)] p-4 text-sm text-[var(--nim-text)]">
              <div className="font-medium">Migration didn&apos;t complete</div>
              <div className="mt-2">Phase: {failure.phase}</div>
              <div className="mt-1">{failure.message}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onCopyDiagnostic} className="rounded-md border border-[var(--nim-border)] px-3 py-2 text-sm text-[var(--nim-text)]">
                Copy diagnostic info
              </button>
              <button type="button" onClick={onClose} className="rounded-md bg-[var(--nim-primary)] px-3 py-2 text-sm font-medium text-white">
                Continue using PGLite
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
