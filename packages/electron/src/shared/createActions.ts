/**
 * Resolves what the title bar's left-hand create button makes, per mode.
 *
 * The bar carries two create controls at opposite ends. The right end always
 * starts a session. The left end sits over the tree column and makes a thing
 * *in that tree* — so the mode picks the noun, and the visible tree selection
 * picks where it lands.
 *
 * This is deliberately a pure function with no React and no IPC: the same
 * resolution backs the button and the Cmd+N accelerator, and the only way to
 * keep those two from drifting is to have one place that decides. It lives in
 * `shared/` because Cmd+N is resolved in the main process and the button in the
 * renderer — before this, Cmd+N in Shared Docs sent `file-new-in-workspace` and
 * opened the *local* file dialog.
 */

/**
 * Mirrors the renderer's `CreateActionMode`. Declared here rather than imported so
 * the main process does not reach into renderer types; the unions are the same
 * shape, so assignment between them stays checked.
 */
export type CreateActionMode =
  | 'files'
  | 'agent'
  | 'tracker'
  | 'collab'
  | 'org'
  | 'pr-review'
  | 'settings';

/** The noun a mode's tree is made of. */
export type CreateKind = 'file' | 'sharedDoc' | 'session' | 'trackerItem';

export interface CreateActionSelection {
  /**
   * Folder selected in the visible tree, if any. A new thing lands here rather
   * than at the root — the same rule the folder context menus already follow.
   */
  selectedFolder?: string | null;
  /** Fallback destination when nothing is selected: workspace, space, tracker. */
  root?: string | null;
}

export interface CreateAction {
  kind: CreateKind;
  /** Names the noun, so the button cannot be misread: "New file", not "New". */
  label: string;
  /** Where it lands. Shown in the menu so the destination is never a guess. */
  destination: string | null;
}

const NOUNS: Partial<Record<CreateActionMode, { kind: CreateKind; label: string }>> = {
  files: { kind: 'file', label: 'New file' },
  collab: { kind: 'sharedDoc', label: 'New doc' },
  agent: { kind: 'session', label: 'New session' },
  tracker: { kind: 'trackerItem', label: 'New item' },
};

/**
 * Returns null for modes with no tree of creatable things (PR Review,
 * Organization, Settings). Those render no left button at all — an absent
 * control beats one that has to invent something to make.
 */
export function resolveCreateAction(
  mode: CreateActionMode,
  selection: CreateActionSelection = {}
): CreateAction | null {
  const noun = NOUNS[mode];
  if (!noun) return null;

  return {
    kind: noun.kind,
    label: noun.label,
    destination: selection.selectedFolder ?? selection.root ?? null,
  };
}
