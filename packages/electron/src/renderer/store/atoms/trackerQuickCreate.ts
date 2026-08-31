import { atom } from 'jotai';
import { atomFamily } from '../debug/atomFamilyRegistry';

export interface TrackerQuickCreateDraft {
  /** Selected tracker type; null until the popup resolves a default. */
  type: string | null;
  title: string;
  description: string;
  /** Field values keyed by their schema field name. */
  fields: Record<string, unknown>;
  /** Field names whose current value carried over from the previous create. */
  carriedFields: string[];
  /** Types in most-recently-used order; drives the pill row's ordering. */
  recentTypes: string[];
  showMoreFields: boolean;
}

export function createEmptyTrackerQuickCreateDraft(): TrackerQuickCreateDraft {
  return {
    type: null,
    title: '',
    description: '',
    fields: {},
    carriedFields: [],
    recentTypes: [],
    showMoreFields: false,
  };
}

/**
 * Transient, workspace-scoped quick-create state, so a half-typed item survives
 * an accidental dismiss. Not persisted — same contract as the session launch
 * popup's draft.
 */
export const trackerQuickCreateDraftAtom = atomFamily((_workspacePath: string) =>
  atom<TrackerQuickCreateDraft>(createEmptyTrackerQuickCreateDraft()),
);
