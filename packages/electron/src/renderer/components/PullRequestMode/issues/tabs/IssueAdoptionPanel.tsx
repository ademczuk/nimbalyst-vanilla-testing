/**
 * Adoption — the one-way escalation from "we have an opinion about this issue"
 * to "this is work we are doing", and the only place in the panel that creates
 * a local copy of GitHub content.
 *
 * Everything else on the Local tab is overlay state, which holds nothing
 * GitHub also holds and therefore cannot drift. Adoption reuses the importer
 * (`issue:adopt` → `TrackerImportService.runImport`), so an adopted issue
 * becomes an ordinary `bug` / `task` / `feature` carrying `origin.external`,
 * participating in team sync and the normal tracker workflow — and from then
 * on it is reconcilable, which is why the reconcile section lives here too.
 *
 * The action is deliberately two-step. It is not undoable from this panel, and
 * it is the decision the whole overlay design exists to keep rare.
 *
 * Adoption is idempotent in the main process: it returns the existing item
 * rather than importing twice. This panel matches that — as soon as a copy of
 * the issue exists (the overlay's `adoptedItemId`, or an item imported before
 * this panel did) it offers a route to that item and never Adopt again.
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { trackerItemsMapAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { FloatingPortal, useFloatingMenu } from '../../../../hooks/useFloatingMenu';
import {
  getGithubIssueService,
  type GithubIssueRow,
} from '../../../../services/RendererGithubIssueService';
import { GithubTrackerBadge } from '../../githubTrackerBadge';
import { PullRequestActionError } from '../../PullRequestActionError';
import { navigateToTrackerItem } from '../../trackerNavigation';
import { collectImportedIssueCopies, findIssueDivergentCopies } from '../issueFilters';
import { IssueLocalSection } from './IssueLocalSection';
import { IssueReconcileSection } from './IssueReconcileSection';

interface IssueAdoptionPanelProps {
  workspaceId: string;
  remote: string;
  issue: GithubIssueRow;
  /** The `github-issue` overlay, or null while the issue has no local state. */
  overlay: TrackerRecord | null;
}

/** Used only when the importer's manifest cannot be read. */
const FALLBACK_ADOPT_TYPES = ['bug', 'task', 'feature'];
const GITHUB_ISSUES_PROVIDER_ID = 'github-issues';

function typeLabel(type: string): string {
  return globalRegistry.get(type)?.displayName ?? type;
}

function itemDisplayKey(record: TrackerRecord | undefined, fallbackId: string): string {
  if (!record) return fallbackId;
  return record.issueKey || getRecordTitle(record) || record.id;
}

/** The types this importer declares it can import as, narrowed to types this workspace has. */
function useAdoptableTypes(workspaceId: string): string[] {
  const [declared, setDeclared] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .invoke('tracker:importer:list', workspaceId)
      .then((list: unknown) => {
        if (cancelled || !Array.isArray(list)) return;
        const importer = list.find(
          (entry: { id?: string }) => entry?.id === GITHUB_ISSUES_PROVIDER_ID,
        ) as { importsAs?: string[] } | undefined;
        if (Array.isArray(importer?.importsAs)) setDeclared(importer.importsAs);
      })
      .catch(() => {
        // Discovery failure is not worth a message; the fallback list is right
        // for every shipped install.
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return useMemo(() => {
    const candidates = declared?.length ? declared : FALLBACK_ADOPT_TYPES;
    const known = candidates.filter((type) => globalRegistry.get(type));
    return known.length > 0 ? known : candidates;
  }, [declared]);
}

function AdoptAction({
  workspaceId,
  remote,
  issue,
  onAdopted,
}: {
  workspaceId: string;
  remote: string;
  issue: GithubIssueRow;
  onAdopted: (adoptedItemId: string) => void;
}): JSX.Element {
  const types = useAdoptableTypes(workspaceId);
  const [primaryType, setPrimaryType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typeMenu = useFloatingMenu({ placement: 'bottom-start' });
  const confirm = useFloatingMenu({ placement: 'top-end' });

  const selectedType = primaryType && types.includes(primaryType) ? primaryType : types[0];

  const adopt = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    confirm.setIsOpen(false);
    try {
      const result = await getGithubIssueService().adopt(workspaceId, remote, issue.number, {
        primaryType: selectedType,
      });
      onAdopted(result.adoptedItemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[11.5px] leading-relaxed text-nim-muted">
        Adopting copies this issue&apos;s title, body and labels into a real tracker item that joins
        the normal workflow. It is the only local copy of GitHub content, so keep it for work we are
        actually going to do — triage state above needs no copy. This cannot be undone from here.
      </p>
      <div className="flex items-center gap-2">
        <button
          ref={typeMenu.refs.setReference}
          {...typeMenu.getReferenceProps()}
          type="button"
          disabled={busy}
          data-testid="issue-adopt-type"
          onClick={() => typeMenu.setIsOpen(!typeMenu.isOpen)}
          className="flex items-center gap-1.5 rounded-md border border-nim bg-nim px-2.5 py-1.5 text-xs text-nim-muted hover:text-nim transition-colors disabled:opacity-60"
        >
          Adopt as {typeLabel(selectedType)}
          <MaterialSymbol icon="arrow_drop_down" size={14} />
        </button>
        {typeMenu.isOpen && (
          <FloatingPortal>
            <div
              ref={typeMenu.refs.setFloating}
              style={typeMenu.floatingStyles}
              {...typeMenu.getFloatingProps()}
              className="z-50 min-w-[150px] bg-nim-secondary border border-nim rounded-md shadow-lg py-1"
            >
              {types.map((type) => (
                <button
                  key={type}
                  className={`w-full px-3 py-1.5 text-left text-xs transition-colors ${
                    type === selectedType
                      ? 'text-nim bg-nim-active'
                      : 'text-nim-muted hover:bg-nim-tertiary hover:text-nim'
                  }`}
                  onClick={() => {
                    setPrimaryType(type);
                    typeMenu.setIsOpen(false);
                  }}
                >
                  {typeLabel(type)}
                </button>
              ))}
            </div>
          </FloatingPortal>
        )}

        <button
          ref={confirm.refs.setReference}
          {...confirm.getReferenceProps()}
          type="button"
          disabled={busy}
          data-testid="issue-adopt"
          onClick={() => confirm.setIsOpen(!confirm.isOpen)}
          className="flex items-center gap-1.5 rounded-md bg-nim-primary px-2.5 py-1.5 text-xs text-nim-on-primary hover:bg-nim-primary-hover transition-colors disabled:opacity-60"
        >
          <MaterialSymbol icon="move_to_inbox" size={14} />
          {busy ? 'Adopting…' : 'Adopt'}
        </button>
        {confirm.isOpen && (
          <FloatingPortal>
            <div
              ref={confirm.refs.setFloating}
              style={confirm.floatingStyles}
              {...confirm.getFloatingProps()}
              className="z-50 w-[280px] bg-nim-secondary border border-nim rounded-md shadow-lg p-3 space-y-2"
              data-testid="issue-adopt-confirm"
            >
              <div className="text-xs text-nim">
                Adopt #{issue.number} as a {typeLabel(selectedType)}?
              </div>
              <div className="text-[11px] text-nim-muted leading-relaxed">
                A tracker item is created with a copy of the issue body, and this issue is marked
                adopted. Escalation is one-way.
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded px-2 py-1 text-[11px] text-nim-muted hover:text-nim"
                  onClick={() => confirm.setIsOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="issue-adopt-confirm-action"
                  className="rounded bg-nim-primary px-2 py-1 text-[11px] text-nim-on-primary hover:bg-nim-primary-hover"
                  onClick={() => void adopt()}
                >
                  Adopt
                </button>
              </div>
            </div>
          </FloatingPortal>
        )}
      </div>
      {error && <PullRequestActionError error={error} />}
    </div>
  );
}

export function IssueAdoptionPanel({
  workspaceId,
  remote,
  issue,
  overlay,
}: IssueAdoptionPanelProps): JSX.Element {
  const itemsById = useAtomValue(trackerItemsMapAtom);
  // The adoption result is held only until the tracker store catches up with
  // the write the main process already made.
  const [justAdoptedId, setJustAdoptedId] = useState<string | null>(null);

  useEffect(() => setJustAdoptedId(null), [issue.number]);

  const overlayAdoptedId =
    typeof overlay?.fields.adoptedItemId === 'string' ? overlay.fields.adoptedItemId : null;
  const adoptedItemId = overlayAdoptedId || justAdoptedId;

  // Copies are found by importer URN, not by reference: an imported item's only
  // pointer at the issue lives in `origin` (see collectImportedIssueCopies), so
  // the panel's reference list never contains one.
  const importedCopies = useMemo(
    () => collectImportedIssueCopies(itemsById.values(), remote).get(issue.number) ?? [],
    [itemsById, remote, issue.number],
  );
  const divergentCopies = useMemo(
    () => findIssueDivergentCopies(issue, remote, importedCopies),
    [issue, remote, importedCopies],
  );

  // An issue imported before this panel existed has no overlay pointing at its
  // copy, but it is adopted all the same — state 3 is "a real tracker item with
  // provenance", not "the overlay says so". Offering Adopt again there would be
  // a no-op the main process would just deduplicate.
  const adoptedRecord =
    (adoptedItemId ? itemsById.get(adoptedItemId) : undefined) ?? importedCopies[0];
  const adoptedId = adoptedRecord?.id ?? adoptedItemId;

  return (
    <>
      <IssueLocalSection
        heading={adoptedId ? 'Adopted' : 'Adopt into the tracker'}
        note={adoptedId ? 'one-way' : undefined}
        testId="issue-adoption"
      >
        {adoptedId ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                data-testid="issue-adopted-item"
                className="font-mono text-[11px] text-nim-muted hover:text-nim hover:underline transition-colors truncate"
                onClick={() => navigateToTrackerItem(adoptedId)}
                title="Open the adopted item in the tracker"
              >
                {itemDisplayKey(adoptedRecord, adoptedId)}
              </button>
              {adoptedRecord && (
                <GithubTrackerBadge record={adoptedRecord} compact markerClass="issue-tracker-badge" />
              )}
            </div>
            <div className="text-[11px] text-nim-faint">
              This issue is tracked locally as a real item. GitHub still owns the issue itself; the
              local copy is refreshed only when you re-snapshot it.
            </div>
          </div>
        ) : (
          <AdoptAction
            workspaceId={workspaceId}
            remote={remote}
            issue={issue}
            onAdopted={setJustAdoptedId}
          />
        )}
      </IssueLocalSection>

      <IssueReconcileSection
        workspaceId={workspaceId}
        issue={issue}
        divergentCopies={divergentCopies}
        labelForItem={(itemId) => itemDisplayKey(itemsById.get(itemId), itemId)}
      />
    </>
  );
}
