/**
 * Warns when the on-disk YAML schemas (the git-tracked init/import format) have
 * fallen out of step with the DB-materialized mirror (the local source of truth
 * read by the `nim` CLI), and offers a non-destructive "Resync from files".
 *
 * Only states a resync can actually fix are listed. A team-owned tracker whose
 * local file is being ignored is classified `team-owned` by
 * `classifyTrackerSchemaDrift`, not `drifted`, so this no longer offers a button
 * whose work would be discarded on the way in.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

/** Mirror of SchemaDriftEntry from the main-process trackerTypeDefStore. */
export type SchemaDriftStatus =
  | 'in-sync'
  | 'drifted'
  | 'yaml-only'
  | 'db-only-orphan'
  | 'db-native'
  | 'team-owned';

export interface SchemaDriftEntry {
  type: string;
  status: SchemaDriftStatus;
  source: string | null;
}

export interface WorkspaceSchemaDrift {
  entries: SchemaDriftEntry[];
  hasDrift: boolean;
}

/** Statuses a resync from files resolves. Everything else is informational. */
const DRIFT_WARNING_STATUSES: ReadonlySet<SchemaDriftStatus> = new Set([
  'drifted',
  'yaml-only',
  'db-only-orphan',
]);

function describeDriftStatus(status: SchemaDriftStatus): string {
  switch (status) {
    case 'drifted': return 'definition differs from file';
    case 'yaml-only': return 'in file, not yet in database';
    case 'db-only-orphan': return 'in database, file missing';
    default: return '';
  }
}

export function TrackerSchemaDriftWarning({ workspacePath }: { workspacePath?: string }) {
  const [drift, setDrift] = useState<WorkspaceSchemaDrift | null>(null);
  const [resyncing, setResyncing] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setDrift(null);
      return;
    }
    try {
      const result: WorkspaceSchemaDrift = await (window as any).electronAPI.invoke(
        'tracker-schema:get-drift',
        workspacePath
      );
      setDrift(result ?? null);
    } catch {
      setDrift(null);
    }
  }, [workspacePath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleResync = useCallback(async () => {
    if (!workspacePath || resyncing) return;
    setResyncing(true);
    try {
      const result: WorkspaceSchemaDrift = await (window as any).electronAPI.invoke(
        'tracker-schema:resync-mirror',
        workspacePath
      );
      setDrift(result ?? null);
    } catch {
      // Leave the existing warning in place on failure.
    } finally {
      setResyncing(false);
    }
  }, [workspacePath, resyncing]);

  if (!drift?.hasDrift) return null;

  const warnings = drift.entries.filter((e) => DRIFT_WARNING_STATUSES.has(e.status));
  if (warnings.length === 0) return null;

  return (
    <div className="provider-panel-section py-4 mb-4 border-b border-[var(--nim-border)] last:border-b-0 last:mb-0 last:pb-0">
      <div
        className="tracker-schema-drift-warning flex items-start gap-2.5 p-3 bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.25)] rounded-lg"
        data-testid="tracker-schema-drift-warning"
      >
        <MaterialSymbol icon="sync_problem" size={14} className="text-[#f59e0b] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-[var(--nim-text)] mb-1">
            Schema files are out of sync
          </div>
          <p className="text-[12px] text-[var(--nim-text-muted)] leading-relaxed mb-2">
            The tracker schema files in <code className="text-[11px] text-[var(--nim-code-text)] bg-[var(--nim-code-bg)] px-1 py-[1px] rounded">.nimbalyst/trackers</code> differ from the local database mirror.
          </p>
          <ul className="text-[12px] text-[var(--nim-text-muted)] leading-relaxed mb-3 space-y-0.5">
            {warnings.map((e) => (
              <li key={e.type} className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] text-[var(--nim-text)]">{e.type}</span>
                <span className="text-[var(--nim-text-faint)]">- {describeDriftStatus(e.status)}</span>
              </li>
            ))}
          </ul>
          <button
            onClick={handleResync}
            disabled={resyncing}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-transparent border border-[rgba(245,158,11,0.4)] rounded text-[#f59e0b] text-[11px] cursor-pointer hover:bg-[rgba(245,158,11,0.12)] disabled:opacity-50 disabled:cursor-default"
            data-testid="tracker-schema-resync-button"
          >
            <MaterialSymbol icon="sync" size={12} />
            {resyncing ? 'Resyncing...' : 'Resync from files'}
          </button>
        </div>
      </div>
    </div>
  );
}
