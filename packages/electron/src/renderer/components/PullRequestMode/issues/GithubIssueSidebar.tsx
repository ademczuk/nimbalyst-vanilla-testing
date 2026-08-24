/**
 * GithubIssueSidebar — filter chips for the issues list.
 *
 * Three groups: upstream state, the local investigation status of the
 * `github-issue` overlay, and the two needs-attention queues. The local group
 * is derived at runtime from that type's workflow statuses (plus any status
 * carried by an item of another type referencing a listed issue), so a status
 * added to the schema later shows up here with no code change. It is hidden
 * entirely until some listed issue has local state — a workspace that has
 * never triaged an issue sees only the upstream chips.
 *
 * The attention chips carry counts because the diverged count is the number
 * the plan watches: it says how much manual reconciliation is being asked for,
 * and therefore when real sync machinery is due.
 */

import type { JSX } from 'react';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { getStatusOptions } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { githubIssueListAtom } from '../../../store/atoms/githubIssues';
import { GithubFilterChips } from '../GithubFilterChips';
import { collectTrackerStatusChips } from '../githubTrackerStatusChips';
import {
  STALE_UNTRIAGED_DAYS,
  type IssueAttentionChip,
  type IssueFilterChip,
} from './issueFilters';
import { ISSUE_OVERLAY_TYPE } from './issueOverlay';
import { useIssueTrackerReferences } from './useIssueTrackerContext';

interface GithubIssueSidebarProps {
  remote: string | null;
  activeFilters: ReadonlyArray<IssueFilterChip>;
  onToggleFilter: (filter: IssueFilterChip) => void;
  activeLocalStatusFilters: ReadonlyArray<string>;
  onToggleLocalStatusFilter: (status: string) => void;
  /** Needs-attention queues per issue number, resolved by the panel. */
  attentionByIssue: ReadonlyMap<number, ReadonlyArray<IssueAttentionChip>>;
  activeAttentionFilters: ReadonlyArray<IssueAttentionChip>;
  onToggleAttentionFilter: (chip: IssueAttentionChip) => void;
}

const FILTER_CHIPS: { id: IssueFilterChip; label: string; icon: string }[] = [
  { id: 'open', label: 'Open', icon: 'adjust' },
  { id: 'closed', label: 'Closed', icon: 'check_circle' },
  { id: 'assigned-to-me', label: 'Assigned to me', icon: 'assignment_ind' },
  { id: 'authored-by-me', label: 'Authored by me', icon: 'person' },
  { id: 'unlabeled', label: 'Unlabeled', icon: 'label_off' },
  { id: 'has-linked-pr', label: 'Has linked PR', icon: 'merge' },
];

const ATTENTION_CHIPS: { id: IssueAttentionChip; label: string; icon: string }[] = [
  { id: 'diverged', label: 'Diverged', icon: 'sync_problem' },
  { id: 'stale', label: `Untriaged ${STALE_UNTRIAGED_DAYS}d+`, icon: 'hourglass_empty' },
];

export function GithubIssueSidebar({
  remote,
  activeFilters,
  onToggleFilter,
  activeLocalStatusFilters,
  onToggleLocalStatusFilter,
  attentionByIssue,
  activeAttentionFilters,
  onToggleAttentionFilter,
}: GithubIssueSidebarProps): JSX.Element {
  const issues = useAtomValue(githubIssueListAtom);
  const references = useIssueTrackerReferences(remote);

  const localStatusChips = useMemo(
    () =>
      collectTrackerStatusChips({
        numbers: issues.map((issue) => issue.number),
        references,
        seedOptions: getStatusOptions(ISSUE_OVERLAY_TYPE),
        activeValues: activeLocalStatusFilters,
      }),
    [issues, references, activeLocalStatusFilters],
  );

  const hasLocalState =
    activeLocalStatusFilters.length > 0 || localStatusChips.some((chip) => chip.count > 0);

  const attentionChips = useMemo(() => {
    const counts = new Map<IssueAttentionChip, number>();
    for (const chips of attentionByIssue.values()) {
      for (const chip of chips) counts.set(chip, (counts.get(chip) ?? 0) + 1);
    }
    return ATTENTION_CHIPS.map((chip) => ({ ...chip, count: counts.get(chip.id) }));
  }, [attentionByIssue]);

  const hasAttention =
    activeAttentionFilters.length > 0 || attentionChips.some((chip) => chip.count);

  return (
    <div
      className="issue-sidebar w-full shrink-0 flex flex-col bg-nim-secondary"
      data-testid="issue-sidebar"
    >
      <div className="px-3 py-2 border-b border-nim">
        <div className="text-[11px] font-semibold text-nim-muted uppercase tracking-wider">
          Issues
        </div>
        {remote && (
          <div className="text-[11px] text-nim-faint truncate mt-0.5" title={remote}>
            {remote}
          </div>
        )}
      </div>

      <GithubFilterChips
        heading="Upstream"
        chips={FILTER_CHIPS}
        activeIds={activeFilters}
        onToggle={onToggleFilter}
        testIdPrefix="issue-filter"
      />

      {hasLocalState && (
        <GithubFilterChips
          heading="Local"
          chips={localStatusChips.map((chip) => ({
            ...chip,
            id: chip.value,
            count: chip.count || undefined,
          }))}
          activeIds={activeLocalStatusFilters}
          onToggle={onToggleLocalStatusFilter}
          testIdPrefix="issue-local-status"
          groupTestId="issue-local-status-filters"
        />
      )}

      {hasAttention && (
        <GithubFilterChips
          heading="Needs attention"
          chips={attentionChips}
          activeIds={activeAttentionFilters}
          onToggle={onToggleAttentionFilter}
          testIdPrefix="issue-attention"
          groupTestId="issue-attention-filters"
        />
      )}
    </div>
  );
}
