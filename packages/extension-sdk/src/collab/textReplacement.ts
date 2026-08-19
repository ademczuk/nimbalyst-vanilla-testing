import type * as Y from 'yjs';

export type ApplyTextEdit = (start: number, end: number, inserted: string) => void;

/** Reduce a whole-string replacement to one contiguous range edit. */
export function applyTextDiff(
  previous: string,
  next: string,
  applyEdit: ApplyTextEdit,
): void {
  if (previous === next) return;

  let prefix = 0;
  const prefixLimit = Math.min(previous.length, next.length);
  while (prefix < prefixLimit && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }

  let suffix = 0;
  const suffixLimit = Math.min(previous.length - prefix, next.length - prefix);
  while (
    suffix < suffixLimit
    && previous.charCodeAt(previous.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  applyEdit(prefix, previous.length - suffix, next.slice(prefix, next.length - suffix));
}

/** Apply a whole-string replacement to a Y.Text as one contiguous edit. */
export function replaceYText(target: Y.Text, next: string): void {
  applyTextDiff(target.toString(), next, (start, end, inserted) => {
    const removeLength = end - start;
    if (removeLength > 0) target.delete(start, removeLength);
    if (inserted.length > 0) target.insert(start, inserted);
  });
}
