// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, replaceYText } from '../collab/textReplacement';

describe('text replacement', () => {
  it('reduces whole-string replacements to one range edit', () => {
    const cases = [
      { name: 'insert-only', previous: 'abcd', next: 'abXcd', edit: [2, 2, 'X'] },
      { name: 'delete-only', previous: 'abcd', next: 'acd', edit: [1, 2, ''] },
      { name: 'replace-in-the-middle', previous: 'abcde', next: 'abXYde', edit: [2, 3, 'XY'] },
      { name: 'identical', previous: 'same', next: 'same', edit: null },
      { name: 'empty-to-nonempty', previous: '', next: 'new', edit: [0, 0, 'new'] },
    ] as const;

    for (const { name, previous, next, edit } of cases) {
      const applyEdit = vi.fn();
      applyTextDiff(previous, next, applyEdit);
      if (edit === null) {
        expect(applyEdit, name).not.toHaveBeenCalled();
      } else {
        expect(applyEdit, name).toHaveBeenCalledOnce();
        expect(applyEdit, name).toHaveBeenCalledWith(...edit);
      }

      const yText = new Y.Text(previous);
      const doc = new Y.Doc();
      doc.getMap('root').set('text', yText);
      replaceYText(yText, next);
      expect(yText.toString(), name).toBe(next);
    }
  });
});
