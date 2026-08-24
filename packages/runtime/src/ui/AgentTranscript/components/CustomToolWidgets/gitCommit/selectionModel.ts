/**
 * Selection state for the commit proposal widget.
 *
 * Kept separate from the widget so the tri-state derivation and the payload
 * shaping can be tested without mounting a transcript. The widget owns two
 * pieces of state: which files are in the commit at all (`Set<string>`, the
 * pre-existing shape), and an optional per-file hunk refinement.
 */

import {
  hunkRefOf,
  supportsHunkSelection,
  type DiffHunk,
  type HunkSelection,
  type ParsedFileDiff,
} from '../../../../git/unifiedDiffModel';

export type CheckboxState = 'all' | 'partial' | 'none';

export interface FileHunkState {
  /** Every hunk in the file's current diff, in file order. */
  hunks: DiffHunk[];
  /** Hunk indices currently checked. */
  selected: Set<number>;
  /** Hunk indices attributed to the proposing session. Drives the banner. */
  sessionOwned: Set<number>;
  /** False for binary/added/deleted files, which can only be staged whole. */
  selectable: boolean;
}

export type HunkStates = ReadonlyMap<string, FileHunkState>;

/**
 * The lines a session added and removed in a file, as text.
 *
 * Deliberately not line numbers. The session's own baseline is its pre-edit
 * snapshot, not HEAD, so if a sibling session wrote the file afterwards every
 * line number below that write is shifted and range comparison misattributes.
 * The text of a line the session wrote does not move.
 */
export interface SessionEditSignature {
  added: ReadonlySet<string>;
  removed: ReadonlySet<string>;
}

/** Blank and trivial lines match everything, so they attribute nothing. */
function isDistinctive(text: string): boolean {
  return text.trim().length > 2;
}

/** Build a signature from a session-scoped unified diff (pre-edit -> post-edit). */
export function buildSessionEditSignature(parsed: ParsedFileDiff): SessionEditSignature {
  const added = new Set<string>();
  const removed = new Set<string>();

  for (const hunk of parsed.hunks) {
    for (const raw of hunk.lines) {
      const text = raw.slice(1);
      if (!isDistinctive(text)) continue;
      if (raw.startsWith('+')) added.add(text);
      else if (raw.startsWith('-')) removed.add(text);
    }
  }

  return { added, removed };
}

function hunkMatchesSignature(hunk: DiffHunk, signature: SessionEditSignature): boolean {
  for (const raw of hunk.lines) {
    const text = raw.slice(1);
    if (!isDistinctive(text)) continue;
    if (raw.startsWith('+') && signature.added.has(text)) return true;
    if (raw.startsWith('-') && signature.removed.has(text)) return true;
  }
  return false;
}

/**
 * Seed a file's hunk state, pre-checking the session's own hunks.
 *
 * Falls back to everything-checked (today's behavior) whenever attribution is
 * unavailable, empty, or covers the whole file. Narrowing only happens when the
 * session genuinely owns a strict subset, and the widget says so out loud.
 */
export function buildFileHunkState(
  parsed: ParsedFileDiff,
  signature?: SessionEditSignature | null
): FileHunkState {
  const selectable = supportsHunkSelection(parsed);
  const hunks = parsed.hunks;
  const sessionOwned = new Set<number>();

  if (selectable && signature && (signature.added.size > 0 || signature.removed.size > 0)) {
    for (const hunk of hunks) {
      if (hunkMatchesSignature(hunk, signature)) sessionOwned.add(hunk.index);
    }
  }

  const narrows = sessionOwned.size > 0 && sessionOwned.size < hunks.length;
  const selected = narrows ? new Set(sessionOwned) : new Set(hunks.map((h) => h.index));

  return { hunks, selected, sessionOwned, selectable };
}

export function fileCheckboxState(
  filePath: string,
  filesToStage: ReadonlySet<string>,
  hunkStates: HunkStates
): CheckboxState {
  if (!filesToStage.has(filePath)) return 'none';

  const state = hunkStates.get(filePath);
  if (!state || !state.selectable || state.hunks.length === 0) return 'all';
  if (state.selected.size === 0) return 'none';
  return state.selected.size === state.hunks.length ? 'all' : 'partial';
}

export function directoryCheckboxState(
  filesInDirectory: readonly string[],
  filesToStage: ReadonlySet<string>,
  hunkStates: HunkStates
): CheckboxState {
  if (filesInDirectory.length === 0) return 'none';

  let all = true;
  let none = true;
  for (const file of filesInDirectory) {
    const state = fileCheckboxState(file, filesToStage, hunkStates);
    if (state === 'partial') return 'partial';
    if (state === 'all') none = false;
    else all = false;
  }
  if (all) return 'all';
  if (none) return 'none';
  return 'partial';
}

/**
 * Files that will actually be committed. A file whose every hunk was unchecked
 * drops out entirely rather than being sent with an empty selection, which the
 * staging path would reject.
 */
export function effectiveStagedFiles(
  filesToStage: ReadonlySet<string>,
  hunkStates: HunkStates
): string[] {
  return [...filesToStage].filter((filePath) => {
    const state = hunkStates.get(filePath);
    if (!state || !state.selectable || state.hunks.length === 0) return true;
    return state.selected.size > 0;
  });
}

/**
 * The `hunkSelections` payload.
 *
 * Only files whose selection is a strict, non-empty subset appear: a fully
 * selected file is cheaper and safer to stage whole, and omitting it keeps the
 * commit working even if the file changed in a way that leaves the hunk refs
 * stale but the whole-file intent intact.
 */
export function buildHunkSelections(
  filesToStage: ReadonlySet<string>,
  hunkStates: HunkStates
): HunkSelection[] {
  const out: HunkSelection[] = [];

  for (const filePath of filesToStage) {
    const state = hunkStates.get(filePath);
    if (!state || !state.selectable) continue;
    if (state.hunks.length === 0) continue;
    if (state.selected.size === 0) continue;
    if (state.selected.size === state.hunks.length) continue;

    out.push({
      path: filePath,
      hunks: [...state.selected]
        .sort((a, b) => a - b)
        .map((index) => hunkRefOf(state.hunks[index])),
    });
  }

  return out;
}

export function excludedHunkCount(state: FileHunkState): number {
  return Math.max(0, state.hunks.length - state.selected.size);
}

export function withHunkToggled(
  hunkStates: HunkStates,
  filePath: string,
  hunkIndex: number
): Map<string, FileHunkState> {
  const next = new Map(hunkStates);
  const state = next.get(filePath);
  if (!state) return next;

  const selected = new Set(state.selected);
  if (selected.has(hunkIndex)) selected.delete(hunkIndex);
  else selected.add(hunkIndex);

  next.set(filePath, { ...state, selected });
  return next;
}

export function withAllHunksSelected(
  hunkStates: HunkStates,
  filePath: string
): Map<string, FileHunkState> {
  const next = new Map(hunkStates);
  const state = next.get(filePath);
  if (!state) return next;

  next.set(filePath, { ...state, selected: new Set(state.hunks.map((h) => h.index)) });
  return next;
}
