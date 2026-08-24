/**
 * IssueLocalTab — the `github-issue` overlay for the selected issue:
 * investigation status, priority, notes, and the links out to sessions, pull
 * requests, and tracker items.
 *
 * Everything here renders off local state only. The issue's title, body,
 * labels and comments are never read from the overlay — they render live from
 * the cache on the other two tabs — which is what keeps the overlay incapable
 * of drifting from GitHub.
 *
 * Nothing on this tab writes on mount. Opening it for an untouched issue shows
 * an empty ladder and creates no tracker item; the first status, priority, or
 * note is what brings the overlay into existence (see issueOverlay.ts).
 */

import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { SessionReferenceChip } from '@nimbalyst/runtime/ui/AgentTranscript/session/SessionReferenceChip';
import type { LinkedIssue, TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { globalRegistry } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import {
  getPriorityOptions,
  getRecordFieldStr,
  getRecordPriority,
  getRecordStatus,
  getRecordTitle,
  getStatusOptions,
  resolveRoleFieldName,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { trackerItemsArrayAtom } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerDataAtoms';
import { buildIssueUrl } from '@nimbalyst/runtime/plugins/TrackerPlugin/issueReferences';
import { FloatingPortal, useFloatingMenu } from '../../../../hooks/useFloatingMenu';
import { navigateToTrackerItem } from '../../trackerNavigation';
import { navigateToPullRequest } from '../../../../store/atoms/pullRequests';
import { setWindowModeAtom } from '../../../../store/atoms/windowMode';
import { dispatchOpenSessionInTab } from '../../../../store/actions/sessionHistoryActions';
import type { GithubIssueRow } from '../../../../services/RendererGithubIssueService';
import { compareTrackerUpdatedAtDesc } from '../../prTrackerSort';
import { GithubTrackerBadge, trackerColorStyle } from '../../githubTrackerBadge';
import { PullRequestActionError } from '../../PullRequestActionError';
import { formatRelative } from '../../prFormat';
import { ISSUE_OVERLAY_TYPE, adoptedItemIdOf } from '../issueOverlay';
import type { IssueOverlayWrite } from '../useIssueOverlay';
import type { IssueTrackerContext } from '../useIssueTrackerContext';
import { IssueAdoptionPanel } from './IssueAdoptionPanel';
import { IssueLocalSection as Panel } from './IssueLocalSection';

interface IssueLocalTabProps {
  workspaceId: string;
  remote: string;
  issue: GithubIssueRow;
  /** Tracker items, overlay, and sessions for this issue, resolved by the panel. */
  context: IssueTrackerContext;
  /** PR numbers referencing this issue, resolved by the panel. */
  linkedPrNumbers: ReadonlyArray<number>;
  /** Applies an overlay write, creating the overlay if this is the first one. */
  onWrite: IssueOverlayWrite;
  /** Loads a linked session into the panel's own chat rail. */
  onOpenSession?: (sessionId: string) => void;
}

/** The ladder, straight off the overlay type's schema. Clicking a step writes. */
function StatusLadder({
  overlay,
  busy,
  locked,
  onSelect,
}: {
  overlay: TrackerRecord | null;
  busy: boolean;
  /** Adopted: the planner refuses status writes, so the ladder says so. */
  locked: boolean;
  onSelect: (status: string) => void;
}): JSX.Element {
  const options = getStatusOptions(ISSUE_OVERLAY_TYPE);
  const current = overlay ? getRecordStatus(overlay) : '';

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="issue-status-ladder">
      {options.map((option) => {
        const isCurrent = option.value === current;
        return (
          <button
            key={option.value}
            type="button"
            disabled={busy || locked}
            data-testid={`issue-status-${option.value}`}
            onClick={() => {
              if (!isCurrent) onSelect(option.value);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:opacity-60 ${
              isCurrent ? 'font-semibold' : 'text-nim-muted hover:text-nim'
            }`}
            style={
              isCurrent
                ? { ...trackerColorStyle(option.color), borderColor: option.color }
                : undefined
            }
            title={
              locked
                ? 'Adopted — the adopted tracker item carries the status from here'
                : isCurrent
                  ? `Currently ${option.label}`
                  : `Set ${option.label}`
            }
          >
            <span
              className="w-[7px] h-[7px] rounded-full shrink-0"
              style={{ backgroundColor: option.color || 'var(--nim-text-muted)' }}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function PriorityPicker({
  overlay,
  busy,
  onSelect,
}: {
  overlay: TrackerRecord | null;
  busy: boolean;
  onSelect: (priority: string) => void;
}): JSX.Element {
  const menu = useFloatingMenu({ placement: 'bottom-start' });
  const options = getPriorityOptions(ISSUE_OVERLAY_TYPE);
  const current = overlay ? getRecordPriority(overlay) : '';
  const option = options.find((o) => o.value === current);

  return (
    <>
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps()}
        type="button"
        disabled={busy}
        data-testid="issue-priority-picker"
        onClick={() => menu.setIsOpen(!menu.isOpen)}
        className="w-full flex items-center justify-between gap-2 rounded-md border border-nim bg-nim px-2.5 py-1.5 text-xs text-nim-muted hover:text-nim transition-colors disabled:opacity-60"
      >
        <span style={option?.color ? { color: option.color } : undefined}>
          {option?.label ?? 'Not set'}
        </span>
        <MaterialSymbol icon="arrow_drop_down" size={14} />
      </button>
      {menu.isOpen && (
        <FloatingPortal>
          <div
            ref={menu.refs.setFloating}
            style={menu.floatingStyles}
            {...menu.getFloatingProps()}
            className="z-50 min-w-[160px] bg-nim-secondary border border-nim rounded-md shadow-lg py-1"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  opt.value === current
                    ? 'text-nim bg-nim-active'
                    : 'text-nim-muted hover:bg-nim-tertiary hover:text-nim'
                }`}
                onClick={() => {
                  menu.setIsOpen(false);
                  if (opt.value !== current) onSelect(opt.value);
                }}
              >
                {opt.icon && <MaterialSymbol icon={opt.icon} size={13} style={{ color: opt.color }} />}
                {opt.label}
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * Triage notes. Saved on blur, and only when the text actually changed —
 * tabbing through an untouched issue must not bring an overlay into existence.
 */
function NotesEditor({
  overlay,
  busy,
  onSave,
}: {
  overlay: TrackerRecord | null;
  busy: boolean;
  onSave: (notes: string) => void;
}): JSX.Element {
  const stored = overlay ? getRecordFieldStr(overlay, 'notes') : '';
  const [draft, setDraft] = useState(stored);

  // Follow the item when it changes underneath (another session's write, or a
  // different issue selected while this tab stays mounted).
  useEffect(() => setDraft(stored), [stored, overlay?.id]);

  return (
    <textarea
      value={draft}
      disabled={busy}
      data-testid="issue-notes"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== stored) onSave(draft);
      }}
      rows={3}
      placeholder="What did we find? Kept local, never written to GitHub."
      className="nim-input w-full text-[11.5px] leading-relaxed resize-y select-text"
    />
  );
}

/** Links an existing tracker item of any type to this issue (system.linkedIssues). */
function LinkTrackerItemButton({
  remote,
  issueNumber,
  alreadyLinkedIds,
}: {
  remote: string;
  issueNumber: number;
  alreadyLinkedIds: Set<string>;
}): JSX.Element {
  const menu = useFloatingMenu({ placement: 'bottom-end' });
  const [query, setQuery] = useState('');
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allItems = useAtomValue(trackerItemsArrayAtom);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems
      .filter((item) => !item.archived && !alreadyLinkedIds.has(item.id))
      .filter(
        (item) =>
          !q ||
          getRecordTitle(item).toLowerCase().includes(q) ||
          item.issueKey?.toLowerCase().includes(q),
      )
      .sort(compareTrackerUpdatedAtDesc)
      .slice(0, 8);
  }, [allItems, alreadyLinkedIds, query]);

  const linkItem = async (record: TrackerRecord) => {
    if (linkingId) return;
    setLinkingId(record.id);
    setError(null);
    try {
      const lowerRemote = remote.toLowerCase();
      const existing: LinkedIssue[] = (record.system.linkedIssues ?? []).filter(
        (ref) => !(ref.remote === lowerRemote && ref.number === issueNumber),
      );
      const linkedIssues: LinkedIssue[] = [
        ...existing,
        { remote: lowerRemote, number: issueNumber, url: buildIssueUrl(lowerRemote, issueNumber) },
      ];
      const tracker = globalRegistry.get(record.primaryType);
      // A rejected write resolves rather than throwing, so closing the menu on
      // the call returning would report a link that was never saved.
      const result = await window.electronAPI.documentService.updateTrackerItem({
        itemId: record.id,
        updates: { linkedIssues },
        sharing: tracker?.sharing ?? 'personal',
        draftByDefault: tracker?.draftByDefault ?? false,
      });
      if (!result.success) {
        setError(result.error || 'Could not link this item.');
        return;
      }
      menu.setIsOpen(false);
      setQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinkingId(null);
    }
  };

  return (
    <>
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps()}
        type="button"
        data-testid="issue-link-tracker-item"
        className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-nim-faint hover:text-nim rounded transition-colors"
        onClick={() => {
          setError(null);
          menu.setIsOpen(!menu.isOpen);
        }}
        title="Link an existing tracker item to this issue"
      >
        <MaterialSymbol icon="add_link" size={13} />
        Link tracker item
      </button>
      {menu.isOpen && (
        <FloatingPortal>
          <div
            ref={menu.refs.setFloating}
            style={menu.floatingStyles}
            {...menu.getFloatingProps()}
            className="z-50 w-[300px] bg-nim-secondary border border-nim rounded-md shadow-lg p-2"
          >
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items by title or key"
              className="nim-input w-full h-7 text-xs mb-1"
              data-testid="issue-link-tracker-search"
            />
            {candidates.length === 0 ? (
              <div className="px-2 py-2 text-xs text-nim-faint">No matching items</div>
            ) : (
              candidates.map((item) => (
                <button
                  key={item.id}
                  disabled={linkingId != null}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs text-nim-muted hover:bg-nim-tertiary hover:text-nim rounded transition-colors disabled:opacity-50"
                  onClick={() => void linkItem(item)}
                >
                  {item.issueKey && (
                    <span className="font-mono text-[10px] text-nim-faint shrink-0">
                      {item.issueKey}
                    </span>
                  )}
                  <span className="truncate">{getRecordTitle(item)}</span>
                  <span className="ml-auto text-[10px] text-nim-faint shrink-0">
                    {item.primaryType}
                  </span>
                </button>
              ))
            )}
            {error && (
              <div className="px-2 pt-1.5" data-testid="issue-link-tracker-error">
                <PullRequestActionError error={error} />
              </div>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export function IssueLocalTab({
  workspaceId,
  remote,
  issue,
  context,
  linkedPrNumbers,
  onWrite,
  onOpenSession,
}: IssueLocalTabProps): JSX.Element {
  const { items, overlay, sessions } = context;
  const setWindowMode = useSetAtom(setWindowModeAtom);
  const [busy, setBusy] = useState(false);

  // Adoption is one-way: the planner refuses status writes once the back-link
  // exists, so the ladder must not offer one (see issueOverlay.ts).
  const adopted = adoptedItemIdOf(overlay) !== null;
  const statusFieldName = resolveRoleFieldName(ISSUE_OVERLAY_TYPE, 'workflowStatus');
  const priorityFieldName = resolveRoleFieldName(ISSUE_OVERLAY_TYPE, 'priority');
  const alreadyLinkedIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  const write = async (
    action: Parameters<IssueOverlayWrite>[0],
    updates: Record<string, unknown>,
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      await onWrite(action, issue, updates);
    } finally {
      setBusy(false);
    }
  };

  const openSession = (sessionId: string) => {
    if (onOpenSession) {
      onOpenSession(sessionId);
      return;
    }
    void dispatchOpenSessionInTab(sessionId).then(() => setWindowMode('agent'));
  };

  const otherItems = items.filter((item) => item.id !== overlay?.id);

  return (
    <div
      className="issue-local-tab flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2.5"
      data-testid="issue-local-tab"
    >
      <Panel
        heading="Investigation status"
        note="local only · never written to GitHub"
        testId="issue-local-status"
      >
        <StatusLadder
          overlay={overlay}
          busy={busy}
          locked={adopted}
          onSelect={(status) => void write('set-status', { [statusFieldName]: status })}
        />
        {!overlay && (
          <div className="mt-2 text-[11px] text-nim-faint">
            No local state for this issue. Picking a status creates one — nothing is copied from
            GitHub, so there is nothing that can fall out of sync.
          </div>
        )}
        {adopted && (
          <div className="mt-2 text-[11px] text-nim-faint" data-testid="issue-status-adopted-note">
            Adopted, and escalation is one-way — the ladder is settled here. The adopted tracker
            item below carries the status from now on.
          </div>
        )}
      </Panel>

      <Panel
        heading="Triage notes"
        note={
          overlay
            ? `${overlay.issueKey ?? ISSUE_OVERLAY_TYPE} · updated ${formatRelative(
                Date.parse(overlay.system.updatedAt) || Date.now(),
              )}`
            : undefined
        }
        testId="issue-local-notes"
      >
        <div className="flex gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] text-nim-faint mb-1">Priority</div>
            <PriorityPicker
              overlay={overlay}
              busy={busy}
              onSelect={(priority) => void write('set-priority', { [priorityFieldName]: priority })}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] text-nim-faint mb-1">Repository</div>
            <div className="rounded-md border border-nim bg-nim px-2.5 py-1.5 text-xs text-nim-muted truncate">
              {remote}
            </div>
          </div>
        </div>
        <NotesEditor
          overlay={overlay}
          busy={busy}
          onSave={(notes) => void write('save-notes', { notes })}
        />
      </Panel>

      {/*
        Adoption (and, once adopted, reconciliation). `issue:adopt` writes the
        overlay itself — it creates or flips it to `adopted` with the back-link
        — so this stays outside the `onWrite` path and issueOverlay.ts keeps its
        three panel write actions.
      */}
      <IssueAdoptionPanel
        workspaceId={workspaceId}
        remote={remote}
        issue={issue}
        overlay={overlay}
      />


      <div className="flex gap-2.5">
        <div className="flex-1 min-w-0">
          <Panel heading="Linked sessions" note={sessions.length ? String(sessions.length) : undefined}>
            {sessions.length === 0 ? (
              <div className="text-[11px] text-nim-faint">
                None yet. Investigate starts one and links it here.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5" data-testid="issue-linked-sessions">
                {sessions.map((session) => (
                  <SessionReferenceChip
                    key={session.id}
                    sessionId={session.id}
                    variant="compact"
                    onOpen={openSession}
                  />
                ))}
              </div>
            )}
          </Panel>
        </div>
        <div className="flex-1 min-w-0">
          <Panel
            heading="Linked pull requests"
            note={linkedPrNumbers.length ? String(linkedPrNumbers.length) : undefined}
          >
            {linkedPrNumbers.length === 0 ? (
              <div className="text-[11px] text-nim-faint">No pull request references this issue.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5" data-testid="issue-linked-prs">
                {linkedPrNumbers.map((prNumber) => (
                  <button
                    key={prNumber}
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-nim px-1.5 py-0.5 font-mono text-[11px] text-nim-muted hover:text-nim transition-colors"
                    onClick={() => navigateToPullRequest(remote, prNumber)}
                    title={`Open pull request #${prNumber}`}
                  >
                    <MaterialSymbol icon="merge" size={12} />#{prNumber}
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Panel heading="Linked tracker items" testId="issue-linked-items">
        <div className="flex flex-wrap items-center gap-2">
          {otherItems.map((item) => (
            <span key={item.id} className="inline-flex items-center gap-1 min-w-0">
              <button
                type="button"
                data-testid="issue-tracker-chip"
                className="font-mono text-[11px] text-nim-muted hover:text-nim hover:underline transition-colors"
                onClick={() => navigateToTrackerItem(item.id)}
                title={`Open ${item.issueKey ?? getRecordTitle(item)} in the tracker`}
              >
                {item.issueKey ?? getRecordTitle(item)}
              </button>
              <GithubTrackerBadge record={item} compact markerClass="issue-tracker-badge" />
            </span>
          ))}
          {otherItems.length === 0 && (
            <span className="text-[11px] text-nim-faint">
              Only the local overlay so far. Linking an existing item lists it here; an adopted
              item is shown above instead, since it points at the issue through its import
              provenance rather than a link.
            </span>
          )}
          <span className="ml-auto">
            <LinkTrackerItemButton
              remote={remote}
              issueNumber={issue.number}
              alreadyLinkedIds={alreadyLinkedIds}
            />
          </span>
        </div>
      </Panel>
    </div>
  );
}
