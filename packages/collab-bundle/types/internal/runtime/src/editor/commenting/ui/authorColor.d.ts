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
export declare function authorColor(userId: string): string;
/** Text color for content sitting on top of {@link authorColor}. */
export declare const AUTHOR_COLOR_FOREGROUND = "#ffffff";
/**
 * First letter of the author's display name. Falls back to the user id so a
 * marker from an author whose name has not resolved yet still reads as a
 * marker rather than an empty disc.
 */
export declare function authorInitial(name: string, userId?: string): string;
