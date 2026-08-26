/**
 * Presentation for the plan status-drift signal, for the board card's chip.
 *
 * The signal itself is derived in the runtime (`derivePlanStatusSignals`); this
 * module only decides how to say it. Two rules it exists to hold:
 *
 *  - **It never writes.** A plan that looks shipped earns a chip, nothing else.
 *    Deriving "shipped" from commits is a heuristic: the audit that motivated
 *    this feature claimed four plans had shipped and two of the four did not
 *    survive reading the commits.
 *  - **It shows the evidence, not a verdict.** The wording is a question, and the
 *    commit shas and session ids ride along so the reader can check rather than
 *    believe. A confident "shipped" badge would be wrong often enough to matter.
 *
 * Signals normally arrive already attached to the record; deriving them here when
 * they are absent keeps the chip correct for records built by a path that skipped
 * the attach step, without introducing a second definition of the signal.
 */

import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  PLAN_STATUS_DRIFT_SIGNAL_KIND,
  derivePlanStatusSignals,
  type PlanStatusDriftSignal,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models/planStatusIntegrity';
import { getRecordStatus } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';

export interface PlanStatusDriftPresentation {
  /** Short chip label; phrased as a question because the signal can be wrong. */
  chipLabel: string;
  /** One-line statement of what disagrees, for the popover heading. */
  headline: string;
  /** Full commit shas, in signal order. */
  commitShas: string[];
  /** Session ids that produced those commits. */
  committedSessionIds: string[];
}

/** How each drifted status reads in the chip and the headline. */
const STATUS_WORDING: Record<PlanStatusDriftSignal['status'], { chip: string; headline: string }> = {
  'draft': {
    chip: 'Draft, but committed?',
    headline: 'Marked draft, but a linked session committed.',
  },
  'ready-for-development': {
    chip: 'Ready, but committed?',
    headline: 'Marked ready for development, but a linked session committed.',
  },
};

function findDriftSignal(item: TrackerRecord): PlanStatusDriftSignal | null {
  const attached = item.system.derivedSignals?.find(
    (signal): signal is PlanStatusDriftSignal => signal.kind === PLAN_STATUS_DRIFT_SIGNAL_KIND,
  );
  if (attached) return attached;

  const [derived] = derivePlanStatusSignals({
    primaryType: item.primaryType,
    status: getRecordStatus(item),
    linkedCommits: item.system.linkedCommits,
  });
  return derived?.kind === PLAN_STATUS_DRIFT_SIGNAL_KIND ? derived : null;
}

/** The chip's content, or null when the item's status and its commits agree. */
export function resolvePlanStatusDriftPresentation(
  item: TrackerRecord,
): PlanStatusDriftPresentation | null {
  const signal = findDriftSignal(item);
  if (!signal) return null;
  const wording = STATUS_WORDING[signal.status];
  if (!wording) return null;
  return {
    chipLabel: wording.chip,
    headline: wording.headline,
    commitShas: [...signal.commitShas],
    committedSessionIds: [...signal.committedSessionIds],
  };
}

/** Abbreviate a sha for display without pretending it is the whole thing. */
export function shortSha(sha: string): string {
  return sha.slice(0, 8);
}
