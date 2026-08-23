/**
 * Deterministic per-author color and initial for comment surfaces.
 *
 * Presence colors are NOT a substitute. `randomCursorColor()` picks a fresh
 * color per session for presence carets, and the comment model carries no
 * color at all, so the same teammate renders differently on every client and
 * after every restart. A comment author's color has to be a pure function of
 * their user id.
 *
 * These are literal hues rather than `--nim-*` theme variables on purpose: the
 * palette is an identity dimension indexed by a hash, not a themed role, so
 * there is no theme token that could hold it. They are chosen mid-dark so they
 * stay legible on both light and dark surfaces and carry white text.
 */

const AUTHOR_COLORS = [
  '#3e63dd',
  '#8e4ec6',
  '#d6409f',
  '#e5484d',
  '#cf5100',
  '#b5820b',
  '#30a46c',
  '#0d9488',
  '#0091ff',
  '#5f6b7a',
] as const;

/** FNV-1a. Stable across clients, restarts, and JS engines. */
function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

export function authorColor(userId: string): string {
  return AUTHOR_COLORS[hash(userId) % AUTHOR_COLORS.length];
}

/** Text color for content sitting on top of {@link authorColor}. */
export const AUTHOR_COLOR_FOREGROUND = '#ffffff';

/**
 * First letter of the author's display name. Falls back to the user id so a
 * marker from an author whose name has not resolved yet still reads as a
 * marker rather than an empty disc.
 */
export function authorInitial(name: string, userId = ''): string {
  const source = `${name} ${userId}`;
  const letter = source.match(/\p{L}|\p{N}/u)?.[0];
  return letter ? letter.toUpperCase() : '?';
}
