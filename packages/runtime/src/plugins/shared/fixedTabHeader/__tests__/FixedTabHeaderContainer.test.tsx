import { render } from '@testing-library/react';
import type { LexicalEditor } from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';

import { FixedTabHeaderContainer } from '../FixedTabHeaderContainer';
import { FixedTabHeaderRegistry } from '../FixedTabHeaderRegistry';
import type { FixedTabHeaderProps } from '../types';

function fakeEditor(): LexicalEditor {
  return { registerUpdateListener: () => () => {} } as unknown as LexicalEditor;
}

describe('FixedTabHeaderContainer', () => {
  afterEach(() => {
    FixedTabHeaderRegistry.getInstance().unregister('test-header');
  });

  // #1578: the Lexical editor is rebuilt on a raw/rich toggle or diff-mode swap.
  // The header kept the first instance, so the find bar counted matches in the
  // destroyed editor and could not highlight or scroll to any of them.
  it('hands header components the new editor after the editor remounts', () => {
    const seen: Array<LexicalEditor | undefined> = [];
    FixedTabHeaderRegistry.getInstance().register({
      id: 'test-header',
      priority: 1,
      shouldRender: (context) => !!context.editor,
      component: ({ editor }: FixedTabHeaderProps) => {
        seen.push(editor);
        return null;
      },
    });

    const first = fakeEditor();
    const second = fakeEditor();
    const { rerender } = render(<FixedTabHeaderContainer filePath="/a.md" fileName="a.md" editor={first} />);
    rerender(<FixedTabHeaderContainer filePath="/a.md" fileName="a.md" editor={undefined} />);
    rerender(<FixedTabHeaderContainer filePath="/a.md" fileName="a.md" editor={second} />);

    expect(seen[seen.length - 1]).toBe(second);
  });
});
