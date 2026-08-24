/**
 * The contract between the GitHub panel's mode component and one of its lists.
 *
 * Each list (pull requests, issues) is driven by a hook that owns its own poll
 * lifecycle, filter vocabulary, selection, and actions, and hands back the
 * nodes plus chat wiring the single shared shell needs. The mode component
 * only picks which set of slots to hand to the shell — it never learns
 * anything list-specific.
 */

import type { ReactNode } from 'react';
import type { SerializableDocumentContext } from '../../hooks/useDocumentContext';

export interface GithubPanelSlots {
  /** Filter sidebar for this list. */
  sidebar: ReactNode;
  /** The list itself. */
  list: ReactNode;
  /** Detail for the current selection, or this list's empty state. */
  detail: ReactNode;
  /** Chat context for the current selection. */
  documentContext: SerializableDocumentContext;
  getDocumentContext: () => Promise<SerializableDocumentContext>;
  /** Identity of the current selection; null when nothing is selected. */
  selectionKey: string | null;
  /** Sessions linked to the current selection, most recent first. */
  selectionSessions: ReadonlyArray<{ id: string }>;
}
