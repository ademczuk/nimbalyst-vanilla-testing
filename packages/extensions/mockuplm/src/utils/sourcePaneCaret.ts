/**
 * Caret preservation for the mockup source pane.
 *
 * The pane is an uncontrolled textarea so a teammate's edit can be written
 * into it without React resetting the caret. Setting `.value` still drops the
 * selection, so the caret is remapped by coordinate against the single
 * replaced range between the old and new text -- the same shape the Y.Text
 * diff in `mockupBinding` emits.
 */

/**
 * Map a caret offset in `prev` to the equivalent offset in `next`.
 *
 * An edit entirely before the caret shifts it by the length delta, so the
 * caret stays on the same character; an edit after it leaves it alone; an
 * edit that spans it clamps into the replacement rather than jumping to the
 * top or the bottom of the document.
 */
export function remapCaretAcrossReplace(
  prev: string,
  next: string,
  caret: number,
): number {
  const clamped = Math.max(0, Math.min(caret, prev.length));

  let prefix = 0;
  const maxPrefix = Math.min(prev.length, next.length);
  while (prefix < maxPrefix && prev.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }
  if (clamped <= prefix) return clamped;

  let suffix = 0;
  const maxSuffix = Math.min(prev.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    prev.charCodeAt(prev.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  if (clamped >= prev.length - suffix) {
    return next.length - (prev.length - clamped);
  }
  return Math.max(prefix, next.length - suffix);
}
