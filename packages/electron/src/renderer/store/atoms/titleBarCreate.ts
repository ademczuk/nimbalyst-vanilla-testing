/**
 * The title bar's left-hand create menu, published by whichever pane owns the
 * visible tree.
 *
 * The bar cannot build these lists itself: the file types come from async
 * extension contributions, the shared-document types from a catalog that gates
 * on sync readiness, and the agent variants on git availability and alpha
 * flags. Lifting all of that into `App` would mean a second copy of each gate,
 * and copies drift. So each sidebar declares its own menu here and the bar just
 * renders it.
 */

import { atom } from 'jotai';
import type { ContentMode } from '../../types/WindowModeTypes';

export interface TitleBarCreateMenuItem {
  id: string;
  label: string;
  icon: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Reason the item is unavailable, e.g. "Worktrees require a git repository". */
  disabledReason?: string;
  /**
   * Carried over from the sidebar control this item replaced, so the E2E specs
   * that drive session creation keep matching after the move.
   */
  testId?: string;
  /** Draws a divider above this item, separating types from containers. */
  separatorBefore?: boolean;
  /**
   * Right-aligned hint: the item's keyboard shortcut, or the extension a type
   * produces. Both were shown by the sidebar menus these items replaced.
   */
  trailing?: string;
}

export interface TitleBarCreateMenu {
  /** Which mode published this. Also its key in the registry. */
  mode: ContentMode;
  items: TitleBarCreateMenuItem[];
  /** Section header above the type list, e.g. "Shared with team". */
  heading?: { label: string; icon: string };
  /** Where a new thing lands, shown so the destination is never a guess. */
  destination?: string | null;
  /** Runs on the button itself when the mode's default differs from item #1. */
  onPrimary?: () => void;
  /** Preserves the testid of the sidebar trigger this menu replaced. */
  menuTestId?: string;
  /** Hint for the mirrored primary entry, e.g. its keyboard shortcut. */
  primaryTrailing?: string;
}

/**
 * Keyed by mode, not a single slot. Every mode component stays mounted (the
 * shell toggles them with CSS display), so all the sidebars publish at once —
 * a single slot meant the last writer won and every other mode showed no menu.
 */
export const titleBarCreateMenusAtom = atom<Partial<Record<ContentMode, TitleBarCreateMenu>>>({});

/** Write-only: publish or clear one mode's menu without touching the others. */
export const setTitleBarCreateMenuAtom = atom(
  null,
  (get, set, mode: ContentMode, menu: TitleBarCreateMenu | null) => {
    const current = get(titleBarCreateMenusAtom);
    if (!menu) {
      if (!(mode in current)) return;
      const next = { ...current };
      delete next[mode];
      set(titleBarCreateMenusAtom, next);
      return;
    }
    set(titleBarCreateMenusAtom, { ...current, [mode]: menu });
  }
);
