/**
 * The `github-issue` overlay: whether a panel interaction writes local state,
 * and which tracker item that write lands on.
 *
 * Three rules live here, all load-bearing, and all invisible at the call site:
 *
 * 1. **Lazy creation.** The overlay is created on the first *write*, never on
 *    the first view. Selecting an issue, opening the Local tab, or rendering a
 *    row must create nothing — an untouched issue has no local object at all,
 *    which is what keeps the tracker from filling with hundreds of triage-noise
 *    items and is what the missing status pill in the list is showing.
 *
 * 2. **Upsert by issue URL.** A write reuses the existing overlay for that URL
 *    instead of creating a second one, so the panel and `/investigate` (which
 *    upserts by `issueUrl` on entry) converge on one item rather than racing to
 *    make two.
 *
 * 3. **Adoption is terminal.** Once the overlay carries an `adoptedItemId`, no
 *    status write from the panel is planned. Escalation is the one decision the
 *    design calls one-way, and a status forwarded over it would misreport the
 *    issue as un-escalated everywhere the overlay is read.
 *
 * Only a `github-issue`-typed item is the overlay. Other types that reference
 * the same issue — an adopted `bug`, one of the legacy native bugs carrying a
 * GitHub link — are shown in the Local tab but never written to: their ladder
 * is their own, and a triage status from this panel would be meaningless in it.
 *
 * `title`, `issueNumber`, `author` and `repo` are mirrored at creation only,
 * for readability in generic tracker views. Nothing re-syncs them, because
 * holding nothing GitHub also holds is what makes drift structurally
 * impossible.
 *
 * Pure — no React, no IPC, no schema registry. useIssueOverlay.ts executes
 * what these functions decide.
 */

import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  getRecordIssueReferences,
  parseIssueUrl,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/issueReferences';

/** The tracker type holding investigation state for a GitHub issue. */
export const ISSUE_OVERLAY_TYPE = 'github-issue';

/** Everything the issues panel can do to an issue that reaches this module. */
export type IssueOverlayAction =
  // Reads. These must plan no write, however much local state exists.
  | 'select-issue'
  | 'open-local-tab'
  | 'render-row'
  // Writes. Each is a human forming an opinion about this issue.
  | 'set-status'
  | 'set-priority'
  | 'save-notes'
  | 'start-session';

const WRITE_ACTIONS: ReadonlySet<IssueOverlayAction> = new Set<IssueOverlayAction>([
  'set-status',
  'set-priority',
  'save-notes',
  // Starting a session is a first write, so it creates the overlay. This is a
  // deliberate divergence from the PR side, where opening a worktree or a
  // review session links to existing items and never creates one: an issue
  // handed to an agent is exactly the decision the overlay exists to record,
  // and `/investigate` writes the same item from the command side.
  'start-session',
]);

export function isOverlayWriteAction(action: IssueOverlayAction): boolean {
  return WRITE_ACTIONS.has(action);
}

/** The upstream facts mirrored into a new overlay, and nothing else. */
export interface IssueOverlaySeed {
  issueUrl: string;
  issueNumber: number;
  title: string;
  author: string | null;
  repo: string;
}

export type IssueOverlayWritePlan =
  | {
      kind: 'create';
      type: typeof ISSUE_OVERLAY_TYPE;
      title: string;
      status: string;
      priority: string;
      customFields: Record<string, unknown>;
    }
  | { kind: 'update'; itemId: string; updates: Record<string, unknown> };

/**
 * The `github-issue` overlay among items referencing this issue, or null when
 * the issue has no local state yet. References are re-checked here rather than
 * trusted, so this is safe to call with any candidate list.
 */
export function findIssueOverlay(
  candidates: ReadonlyArray<TrackerRecord>,
  issueUrl: string,
): TrackerRecord | null {
  const wanted = parseIssueUrl(issueUrl);
  if (!wanted) return null;
  for (const record of candidates) {
    if (record.primaryType !== ISSUE_OVERLAY_TYPE) continue;
    const matches = getRecordIssueReferences(record).some(
      (ref) => ref.remote === wanted.remote && ref.number === wanted.number,
    );
    if (matches) return record;
  }
  return null;
}

/**
 * The overlay's back-link to the item it was escalated into, or null while the
 * issue has not been adopted. Its presence — not the `adopted` status — is what
 * says a copy exists, because the status can be written from several places and
 * the back-link only by adoption.
 */
export function adoptedItemIdOf(record: TrackerRecord | null | undefined): string | null {
  const value = record?.fields.adoptedItemId;
  return typeof value === 'string' && value.trim() ? value : null;
}

export interface IssueOverlayWriteRequest {
  action: IssueOverlayAction;
  seed: IssueOverlaySeed;
  /** Tracker items already referencing this issue, of any type. */
  references: ReadonlyArray<TrackerRecord>;
  /** The overlay fields this action sets, by schema field name. */
  updates: Record<string, unknown>;
  /** The overlay type's default workflow status, read from its schema. */
  defaultStatus: string;
}

/**
 * What (if anything) to write for one panel interaction: nothing for a read,
 * an update of the existing overlay, or a create carrying the mirrored fields.
 */
export function planIssueOverlayWrite({
  action,
  seed,
  references,
  updates,
  defaultStatus,
}: IssueOverlayWriteRequest): IssueOverlayWritePlan | null {
  if (!isOverlayWriteAction(action)) return null;

  const existing = findIssueOverlay(references, seed.issueUrl);
  if (existing) {
    // Adoption is one-way, and this is where that holds. Once `issue:adopt`
    // has written the back-link and flipped the status to `adopted`, forwarding
    // another status would leave the overlay adopted-but-not-`adopted`, which
    // every row pill and local filter then reads as un-escalated — and nothing
    // repairs it, because the panel no longer offers Adopt. The ladder is
    // disabled in the UI too; this guard is what holds when a write reaches
    // here anyway.
    if (action === 'set-status' && adoptedItemIdOf(existing)) return null;
    // Only what this action set. The mirrored upstream fields are never
    // rewritten, so the overlay cannot drift from GitHub.
    return { kind: 'update', itemId: existing.id, updates };
  }

  const { status, priority, ...rest } = updates;
  return {
    kind: 'create',
    type: ISSUE_OVERLAY_TYPE,
    title: seed.title,
    status: typeof status === 'string' && status ? status : defaultStatus,
    priority: typeof priority === 'string' ? priority : '',
    customFields: {
      issueUrl: seed.issueUrl,
      issueNumber: seed.issueNumber,
      ...(seed.author ? { author: seed.author } : {}),
      repo: seed.repo,
      ...rest,
    },
  };
}
