/**
 * Storage retention controls: how much tool output to keep at full fidelity,
 * and how many backup generations to hold.
 *
 * Before this existed, backups were a hardcoded rolling-3 every 4 hours with
 * no user control, so a 4.6 GiB database silently occupied 18.5 GiB on disk
 * (#1248). Tool output is the other half: on a real install it was 87% of the
 * message table, against 5.5% for user prompts and agent text combined.
 */
import { useEffect, useState } from 'react';

interface MaintenanceSettings {
  backupCopiesKept: number;
  backupIntervalHours: number;
  toolOutputRetentionDays: number;
}

interface RetentionEstimate {
  candidateRows: number;
  estimatedBytesSaved: number;
  sampledRows: number;
}

interface RetentionRunResult {
  scanned: number;
  rewritten: number;
  bytesSaved: number;
  stoppedEarly: boolean;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const RETENTION_CHOICES = [
  { value: 0, label: 'Keep everything' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
];

const COPIES_CHOICES = [1, 2, 3];

const INTERVAL_CHOICES = [
  { value: 0, label: 'On quit only' },
  { value: 4, label: 'Every 4 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Daily' },
];

const selectClass =
  'text-xs bg-nim-primary border border-[var(--nim-border)] rounded px-2 py-1 text-[var(--nim-text)]';

export function StorageRetentionCard() {
  const [settings, setSettings] = useState<MaintenanceSettings | null>(null);
  const [estimate, setEstimate] = useState<RetentionEstimate | null>(null);
  const [result, setResult] = useState<RetentionRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDays, setPendingDays] = useState(30);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // A rejected invoke here must surface as the card's error state, not an
      // unhandled rejection that takes out whatever else is mounted.
      try {
        const res = await window.electronAPI.invoke('database:maintenance:get');
        if (cancelled) return;
        if (res.success) {
          setSettings(res.settings);
          if (res.settings.toolOutputRetentionDays > 0) {
            setPendingDays(res.settings.toolOutputRetentionDays);
          }
        } else {
          setError(res.error || 'Could not read maintenance settings');
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const patch = async (next: Partial<MaintenanceSettings>) => {
    setError(null);
    try {
      const res = await window.electronAPI.invoke('database:maintenance:set', next);
      if (res.success) setSettings(res.settings);
      else setError(res.error || 'Could not save settings');
    } catch (err) {
      setError(String(err));
    }
  };

  const runEstimate = async () => {
    setError(null);
    setResult(null);
    try {
      const res = await window.electronAPI.invoke('database:toolRetention:estimate', {
        retentionDays: pendingDays,
      });
      if (res.success) setEstimate(res.estimate);
      else setError(res.error || 'Estimate failed');
    } catch (err) {
      setError(String(err));
    }
  };

  const runPass = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await window.electronAPI.invoke('database:toolRetention:run', {
        retentionDays: pendingDays,
      });
      if (res.success) setResult(res.result);
      else setError(res.error || 'Reclaim failed');
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-4 rounded-lg border border-[var(--nim-border)] bg-nim-secondary storage-retention-card">
      <div className="text-sm font-semibold mb-1">Storage retention</div>
      <div className="text-xs text-[var(--nim-text-muted)] mb-3">
        Tool output (command results, file reads, search output) is the bulk of the database.
        Discarding aged tool output never touches your prompts, the agent&apos;s replies, or what
        the agent did — tool names, arguments, and file edits are all preserved.
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs">Keep full tool output for</span>
          <select
            className={selectClass}
            value={pendingDays}
            onChange={(e) => setPendingDays(Number(e.target.value))}
          >
            {RETENTION_CHOICES.filter((c) => c.value > 0).map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border border-[var(--nim-border)] hover:bg-nim-hover"
            onClick={runEstimate}
            disabled={running}
          >
            Estimate savings
          </button>
          <button
            type="button"
            className="text-xs px-2 py-1 rounded border border-[var(--nim-border)] hover:bg-nim-hover"
            onClick={runPass}
            disabled={running}
          >
            {running ? 'Reclaiming…' : 'Discard older tool output'}
          </button>
        </div>

        {estimate && (
          <div className="text-xs text-[var(--nim-text-muted)]">
            About {formatBytes(estimate.estimatedBytesSaved)} across{' '}
            {estimate.candidateRows.toLocaleString()} messages, estimated from a{' '}
            {estimate.sampledRows.toLocaleString()}-row sample.
          </div>
        )}

        {result && (
          <div className="text-xs text-[var(--nim-text-muted)]">
            Reclaimed {formatBytes(result.bytesSaved)} from{' '}
            {result.rewritten.toLocaleString()} of {result.scanned.toLocaleString()} messages
            {result.stoppedEarly ? ' (stopped early; run again to continue)' : ''}. Run VACUUM
            above to return the freed pages to disk.
          </div>
        )}

        <hr className="border-[var(--nim-border)]" />

        <div className="text-xs text-[var(--nim-text-muted)]">
          Each backup is a full copy of the database, so keeping more multiplies disk usage.
        </div>

        <label className="flex items-center justify-between gap-3">
          <span className="text-xs">Backup copies kept</span>
          <select
            className={selectClass}
            value={settings?.backupCopiesKept ?? 2}
            onChange={(e) => void patch({ backupCopiesKept: Number(e.target.value) })}
          >
            {COPIES_CHOICES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-3">
          <span className="text-xs">Back up</span>
          <select
            className={selectClass}
            value={settings?.backupIntervalHours ?? 12}
            onChange={(e) => void patch({ backupIntervalHours: Number(e.target.value) })}
          >
            {INTERVAL_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>

        <div className="text-xs text-[var(--nim-text-muted)]">
          Backup cadence changes take effect on the next restart.
        </div>
      </div>

      {error && <div className="text-xs text-[var(--nim-error)] mt-2">{error}</div>}
    </div>
  );
}
