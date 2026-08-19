/**
 * Covers the seam between "a line resolves to a block" and "the reader sees
 * it": the reveal has to find the block's rendered element, scroll it into
 * view, and mark it. A wrong node key or a missing element here is invisible --
 * the file just sits at the top, which is also what a stale link looks like.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createEditor, type LexicalEditor } from 'lexical';
import { ListNode, ListItemNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { $convertFromEnhancedMarkdownString } from '../EnhancedMarkdownImport';
import { REVEALED_BLOCK_CLASS, revealMarkdownLine } from '../revealMarkdownLine';
import { CORE_TRANSFORMERS } from '../core-transformers';

const MARKDOWN = `---
title: Reveal
---
# Heading

First paragraph.

Second paragraph.

Third paragraph.`;

describe('revealMarkdownLine', () => {
  let editor: LexicalEditor;
  let root: HTMLDivElement;
  let scrollSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    scrollSpy = vi.fn();
    // jsdom has no layout, so scrollIntoView is absent entirely.
    Element.prototype.scrollIntoView = scrollSpy as unknown as Element['scrollIntoView'];

    root = document.createElement('div');
    document.body.appendChild(root);

    editor = createEditor({
      nodes: [ListNode, ListItemNode, HeadingNode, QuoteNode, CodeNode, LinkNode],
      onError: (e) => { throw e; },
    });
    editor.setRootElement(root);

    editor.update(() => {
      $convertFromEnhancedMarkdownString(MARKDOWN, CORE_TRANSFORMERS);
    });
    // Let Lexical flush its reconciliation so getElementByKey resolves.
    await Promise.resolve();
  });

  afterEach(() => {
    editor.setRootElement(null);
    root.remove();
    vi.useRealTimers();
  });

  function reveal(line: number, sourceText = MARKDOWN) {
    return revealMarkdownLine({ editor, transformers: CORE_TRANSFORMERS, line, sourceText });
  }

  it('scrolls to the element for the targeted line and marks it', () => {
    // Line 8 is "Second paragraph." (frontmatter occupies 1-3).
    expect(reveal(8)).toBe(true);
    expect(scrollSpy).toHaveBeenCalledOnce();

    const marked = root.querySelector(`.${REVEALED_BLOCK_CLASS}`);
    expect(marked?.textContent).toBe('Second paragraph.');
  });

  it('clears the marker and restores scroll margin once the flash ends', () => {
    reveal(8);
    const marked = root.querySelector(`.${REVEALED_BLOCK_CLASS}`) as HTMLElement;
    expect(marked.style.scrollMarginTop).not.toBe('');

    vi.runAllTimers();

    expect(root.querySelector(`.${REVEALED_BLOCK_CLASS}`)).toBeNull();
    expect(marked.style.scrollMarginTop).toBe('');
  });

  it('clamps a line past the end of the document to the last block', () => {
    expect(reveal(9999)).toBe(true);
    expect(root.querySelector(`.${REVEALED_BLOCK_CLASS}`)?.textContent).toBe('Third paragraph.');
  });

  it('does nothing on an empty document rather than throwing', () => {
    const empty = createEditor({
      nodes: [ListNode, ListItemNode, HeadingNode, QuoteNode, CodeNode, LinkNode],
      onError: (e) => { throw e; },
    });
    const emptyRoot = document.createElement('div');
    document.body.appendChild(emptyRoot);
    empty.setRootElement(emptyRoot);

    expect(
      revealMarkdownLine({ editor: empty, transformers: CORE_TRANSFORMERS, line: 5 })
    ).toBe(false);

    empty.setRootElement(null);
    emptyRoot.remove();
  });
});
