/**
 * The lifecycle transitions of a tracker and its items, as pure functions.
 *
 * Three transitions live here, and they are the invisible part of the sharing
 * model -- what a reader cannot see by looking at the screen:
 *
 *   - **Draft -> Published** (per item). A draft has NO issue key at all (D2);
 *     the room mints one at publication and it is never rewritten afterwards.
 *   - **Personal -> Team** (per tracker). One-way. Promotion publishes the
 *     existing items, which is when they receive their keys.
 *   - **Active -> Archived** (per tracker). Items are RETAINED and become
 *     read-only, so everything stays visible, searchable and keyed. Archiving
 *     is not deletion and is not a demotion back to personal.
 *
 * Pure and I/O-free on purpose: the Electron main process drives the writes,
 * the renderer draws the surfaces, and both agree on the rules stated here.
 */

import type { TrackerDataModel } from './TrackerDataModel';

/**
 * The settled wording for an item that has no key yet. An unkeyed draft is
 * normal and intentional, not a failure -- this sentence is what says so.
 *
 * This module is the single source for the sentences below. The agent
 * tools import them directly; the CLI cannot (it vendors rather than depending
 * on the runtime, see `packages/cli/src/vendor/trackerRecord.ts`) and carries a
 * marked copy. Two hand-copies previously drifted here: only this file grew
 * `TRACKER_LOCAL_ISSUE_KEY_MESSAGE`, so the tools and the CLI kept telling a
 * numbered personal item it had "no key until it is published" -- on trackers
 * where publishing is refused outright (#1346, #1243).
 */
export const TRACKER_UNASSIGNED_ISSUE_KEY_MESSAGE = 'This item has no key until it is published.';

/**
 * The settled wording for a workspace that has no team to mint keys.
 *
 * "Publish it" is the advice the other messages imply, and it is a dead end
 * here: publication succeeds locally and then waits on a room that does not
 * exist. Saying so is the whole point -- #1346 sat for nine days because the
 * app reported a pending key instead of an absent room.
 */
export const TRACKER_NO_TEAM_ISSUE_KEY_MESSAGE =
  'This workspace has no team, so no shared issue key can be issued — publishing will not produce one.';

/**
 * The settled wording for this machine's private number. The point it has to
 * land is that the number is not shareable: the same value on a colleague's
 * machine is a different item, so pasting it into a commit or a message sends
 * them somewhere else or nowhere at all.
 */
export const TRACKER_LOCAL_ISSUE_KEY_MESSAGE =
  'This number is private to this project on this machine. It is not a shared key — '
  + 'do not use it in commit messages or anywhere another person will read it.';

/**
 * The same point in one line, for a diagnostic surface that lists several refs
 * at once and would be drowned by the full sentence. Lifted verbatim from the
 * wording `TrackerBlockedChip` states inline; that component should import this
 * rather than restate it, so the two never drift into different advice.
 */
export const TRACKER_LOCAL_ISSUE_KEY_BRIEF_MESSAGE =
  'Dotted refs are numbered on this machine only — they will not resolve for anyone else.';

/**
 * What a dependency cycle means and what to do about it. Two surfaces explain
 * this one deadlock -- `TrackerDependencyCycleBanner` and the hover card in
 * `TrackerBlockedChip` -- and hand-maintained copies of an explanation are how
 * two surfaces end up giving different advice about the same hazard.
 *
 * Verbatim from the chip, so adopting it there is a no-op: that component still
 * states the sentence inline and should import this instead. It reads correctly
 * in both placements -- the banner introduces the cycle in the sentence before,
 * and the chip's card has no antecedent, which is why the subject is named
 * rather than pronominal.
 */
export const TRACKER_DEPENDENCY_CYCLE_MESSAGE =
  'These items depend on each other, so none of them can become ready until one of the links is removed.';

/** Whether a tracker has been retired. Absent means active. */
export function isTrackerArchived(model: Pick<TrackerDataModel, 'archived'> | null | undefined): boolean {
  return model?.archived === true;
}

export interface TrackerWriteAccess {
  canWrite: boolean;
  /** Why writes are refused, phrased for a person. Absent when writable. */
  readOnlyReason?: string;
}

const WRITABLE: TrackerWriteAccess = { canWrite: true };

/**
 * Whether items in this tracker can still be edited.
 *
 * Read-only is the ONLY consequence of archiving. Reading, searching, following
 * a link and resolving an issue key all keep working -- so callers must gate
 * edit affordances on this and never gate visibility on it.
 */
export function resolveTrackerWriteAccess(
  model: Pick<TrackerDataModel, 'archived' | 'displayNamePlural'> | null | undefined,
): TrackerWriteAccess {
  if (!isTrackerArchived(model)) return WRITABLE;
  const name = model?.displayNamePlural?.trim();
  return {
    canWrite: false,
    readOnlyReason: `${name || 'This tracker'} is archived. Its items are kept and stay searchable, but they can no longer be edited.`,
  };
}

export type TrackerPromotionBlockedReason = 'archived';
export type TrackerPromotionMode = 'promote' | 'resume';

export interface TrackerPromotionEligibility {
  canPromote: boolean;
  /** First ownership transition, or an idempotent replay that finishes its item sweep. */
  mode?: TrackerPromotionMode;
  blockedReason?: TrackerPromotionBlockedReason;
  /** Why promotion is unavailable, or why replay is safe, phrased for a person. */
  message?: string;
}

/**
 * Whether a personal tracker can be promoted to the team.
 *
 * There is deliberately no inverse. Once the schema belongs to the team, this
 * same forward action remains available as an idempotent replay of the item
 * publication sweep. That is the recovery path after a partial promotion: items
 * that already finished keep their ids and keys, while unfinished items retry.
 * A team tracker is never demoted back to personal because that would strand
 * every teammate's items; archiving is the answer to "we should stop using this
 * tracker".
 */
export function resolveTrackerPromotionEligibility(
  model: Pick<TrackerDataModel, 'sharing' | 'archived'> | null | undefined,
): TrackerPromotionEligibility {
  if (isTrackerArchived(model)) {
    return {
      canPromote: false,
      blockedReason: 'archived',
      message: 'An archived tracker cannot be shared with the team.',
    };
  }
  if (model?.sharing === 'team') {
    return {
      canPromote: true,
      mode: 'resume',
      message: 'This tracker already belongs to the team. Run sharing again to finish publishing any items left by an earlier failure.',
    };
  }
  return { canPromote: true, mode: 'promote' };
}

export interface TrackerConfirmationCopy {
  title: string;
  /** What will happen, stated plainly, including whether it can be undone. */
  message: string;
  confirmLabel: string;
}

/**
 * What the promotion confirmation says. Promotion is not destructive, but it is
 * irreversible and it hands the items to other people, so the copy names both
 * consequences: numbers get issued now, and there is no way back.
 */
export function describeTrackerPromotion(
  model: Pick<TrackerDataModel, 'displayNamePlural' | 'sharing'>,
  itemCount: number,
): TrackerConfirmationCopy {
  const name = model.displayNamePlural;
  const items = itemCount === 1 ? '1 item' : `${itemCount} items`;
  if (model.sharing === 'team') {
    return {
      title: `Finish sharing ${name}?`,
      message:
        `${name} already belongs to your team. The publication sweep will run again for ${items}, ` +
        `keeping every existing item id and issue key while unfinished items retry. ` +
        `This only moves forward; it never makes the tracker personal again.`,
      confirmLabel: 'Finish sharing',
    };
  }
  return {
    title: `Share ${name} with your team?`,
    message:
      `Your team gets ${name} — its fields, its items and its numbering. ` +
      `${items} will be published now and each one receives its issue key at that moment. ` +
      `Editing the fields from then on changes them for everyone. ` +
      `This cannot be undone: a team tracker is never made personal again, because that would take teammates' items away from them. ` +
      `To stop using it later, archive it instead.`,
    confirmLabel: `Share with team`,
  };
}

/**
 * What the archive confirmation says. The whole job of this copy is to keep
 * archiving from reading as deletion, so it leads with what is kept.
 */
export function describeTrackerArchive(
  model: Pick<TrackerDataModel, 'displayNamePlural'>,
  itemCount: number,
): TrackerConfirmationCopy {
  const name = model.displayNamePlural;
  const items = itemCount === 1 ? 'Its 1 item' : `All ${itemCount} items`;
  return {
    title: `Archive ${name}?`,
    message:
      `${items} are kept. They stay visible and searchable, every issue key still resolves, and nothing is deleted. ` +
      `${name} stops being used: its items become read-only and no new ones can be added. ` +
      `You can unarchive it at any time.`,
    confirmLabel: 'Archive tracker',
  };
}

export function describeTrackerUnarchive(
  model: Pick<TrackerDataModel, 'displayNamePlural'>,
): TrackerConfirmationCopy {
  return {
    title: `Unarchive ${model.displayNamePlural}?`,
    message: `${model.displayNamePlural} becomes editable again and new items can be added.`,
    confirmLabel: 'Unarchive tracker',
  };
}

export class TrackerIssueKeyRewriteError extends Error {
  constructor(readonly itemId: string, readonly existingKey: string, readonly incomingKey: string) {
    super(
      `Issue key for ${itemId} would change from ${existingKey} to ${incomingKey}. ` +
      `A key is minted once, at publication, and never rewritten.`,
    );
    this.name = 'TrackerIssueKeyRewriteError';
  }
}

/**
 * The key an item holds after a publish attempt.
 *
 * This is the D2 invariant in one place: publishing a keyless item adopts the
 * key the room minted; publishing an item that already has one KEEPS it, so a
 * re-publish (or a promotion that sweeps an already-published item) can never
 * consume a second number or renumber a key people have already cited.
 *
 * A disagreement is a bug in the room or the caller, never something to paper
 * over by picking a winner -- so it throws.
 */
export function reconcileIssueKeyOnPublish(params: {
  itemId: string;
  /** The key the item carried before publishing, if any. */
  existingKey?: string | null;
  /** The key observed on the item after publishing, if the room minted one. */
  mintedKey?: string | null;
}): { issueKey?: string; minted: boolean } {
  const existing = params.existingKey?.trim() || undefined;
  const minted = params.mintedKey?.trim() || undefined;
  if (existing && minted && existing !== minted) {
    throw new TrackerIssueKeyRewriteError(params.itemId, existing, minted);
  }
  if (existing) return { issueKey: existing, minted: false };
  return { issueKey: minted, minted: Boolean(minted) };
}
