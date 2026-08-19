/**
 * Scroll the rich markdown view to the block a file line belongs to.
 *
 * A line link (`notes.md:653`) targets source text, but the rich view has no
 * lines -- only blocks. This builds a line map from the live document, resolves
 * the line to a block, and scrolls there, flashing the block briefly so the
 * reader can see which one the link meant. Block granularity is approximate, so
 * without that marker there is no way to tell "landed on it" from "landed near
 * it".
 *
 * Silently does nothing when the line cannot be resolved. The file is already
 * open at the top, which is the intended degraded state for a stale link.
 */

import type { LexicalEditor } from 'lexical';
import type { Transformer } from '@lexical/markdown';

import { $buildMarkdownLineMap, $convertToEnhancedMarkdownString } from './EnhancedMarkdownExport';
import { resolveMarkdownBlockForLine } from './resolveMarkdownBlockForLine';

/** Class applied to the revealed block; the fade-out is defined in CSS. */
export const REVEALED_BLOCK_CLASS = 'nim-revealed-block';

/** Matches the highlight animation duration in index.css. */
const HIGHLIGHT_DURATION_MS = 1600;

/** Clearance above the revealed block, so it does not sit flush against the header. */
const SCROLL_MARGIN_TOP = '100px';

export interface RevealMarkdownLineOptions {
  editor: LexicalEditor;
  transformers: Array<Transformer>;
  /** 1-based line from the link. */
  line: number;
  /**
   * The file's text as loaded from disk. Used to read the target line and
   * correct for drift between the on-disk text and the live document.
   */
  sourceText?: string;
}

/** Returns true when a block was found and scrolled to. */
export function revealMarkdownLine({
  editor,
  transformers,
  line,
  sourceText,
}: RevealMarkdownLineOptions): boolean {
  let nodeKey: string | null = null;

  editor.getEditorState().read(() => {
    const ranges = $buildMarkdownLineMap(transformers);
    if (ranges.length === 0) return;

    const exportedLines = $convertToEnhancedMarkdownString(transformers).split('\n');
    nodeKey = resolveMarkdownBlockForLine({
      ranges,
      exportedLines,
      targetLine: line,
      sourceLineText: sourceText?.split('\n')[line - 1],
    });
  });

  if (!nodeKey) return false;

  const element = editor.getElementByKey(nodeKey) as HTMLElement | null;
  if (!element) return false;

  const previousScrollMargin = element.style.scrollMarginTop;
  element.style.scrollMarginTop = SCROLL_MARGIN_TOP;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });

  element.classList.add(REVEALED_BLOCK_CLASS);
  setTimeout(() => {
    element.style.scrollMarginTop = previousScrollMargin;
    element.classList.remove(REVEALED_BLOCK_CLASS);
  }, HIGHLIGHT_DURATION_MS);

  return true;
}
