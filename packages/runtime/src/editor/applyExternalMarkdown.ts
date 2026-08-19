/**
 * In-place external content replacement for a mounted Lexical editor.
 *
 * The alternative -- remounting the editor with new `initialContent` -- throws
 * away the caret, the selection, undo history and any in-flight IME
 * composition. That is unacceptable for content that arrives while the user is
 * typing: a collaborator's edit, a file-watcher event, an agent's write.
 *
 * Replacement is still a full re-parse (Lexical node keys do not survive it),
 * so the caret is preserved by *coordinate*, not by node identity:
 *
 *   1. Linearize the old editor state into a flat string, remembering which
 *      TextNode owns each range of it, and record the selection's offsets in
 *      that string.
 *   2. Clear the root and re-import the markdown through
 *      `$convertFromEnhancedMarkdownString` + `getEditorTransformers()` -- the
 *      same enhanced path every other host content update uses, so frontmatter
 *      extraction, list-indent normalization, the NCR literal-emphasis
 *      encoding and every extension-contributed transformer stay applied.
 *   3. Linearize the new state, map the old offsets across the change by the
 *      character diff of the two flat strings, and re-anchor the selection
 *      there.
 *
 * The mapping means an edit that lands *above* the caret shifts the caret down
 * by exactly the length of what was inserted -- the caret stays on the same
 * character it was on. An edit strictly *below* it leaves it alone. An edit
 * that overlaps the caret is genuinely ambiguous; the caret is clamped into the
 * replacement rather than jumping to the top of the document.
 */

import {
  $createRangeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
} from 'lexical';
import { diffChars } from 'diff';

import { getEditorTransformers } from './markdown';
import {
  $convertFromEnhancedMarkdownString,
  $updateFrontmatter,
} from './markdown/EnhancedMarkdownImport';

/**
 * Marks an update whose content came from outside the editor (collaborator,
 * file watcher, agent). Consumers use it to tell "the document changed under
 * the user" apart from "the user typed" -- notably Editor.tsx's dirty tracker,
 * which must not flag an external replacement as unsaved local work.
 */
export const EXTERNAL_CONTENT_UPDATE_TAG = 'nimbalyst-external-content';

/** Stands in for the gap between two block-level nodes when linearizing. */
const BLOCK_SEPARATOR = '\n';

interface FlatSegment {
  key: string;
  start: number;
  length: number;
}

interface FlatText {
  text: string;
  /** TextNode-backed ranges, in document order. Only these can hold a caret. */
  segments: FlatSegment[];
  /** Flat range of every node, keyed by node key. */
  spans: Map<string, { start: number; end: number }>;
}

/**
 * Flatten the current editor state into a single string plus an index from
 * node key to the range it occupies.
 *
 * This is deliberately *not* `root.getTextContent()`: the caret has to be
 * mapped back onto a concrete TextNode afterwards, which needs per-node ranges
 * produced by the exact same walk on both sides of the replacement.
 */
function $flattenEditorText(): FlatText {
  const parts: string[] = [];
  const segments: FlatSegment[] = [];
  const spans = new Map<string, { start: number; end: number }>();
  let offset = 0;

  const append = (text: string): void => {
    if (!text) return;
    parts.push(text);
    offset += text.length;
  };

  const visit = (node: LexicalNode): void => {
    const start = offset;

    if ($isElementNode(node)) {
      const children = node.getChildren();
      children.forEach((child, index) => {
        // Separate block siblings so an inserted paragraph reads as an
        // insertion rather than silently fusing with its neighbour. Inline
        // elements (links, marks) are part of their paragraph's run.
        if (index > 0 && $isElementNode(child) && !child.isInline()) {
          append(BLOCK_SEPARATOR);
        }
        visit(child);
      });
    } else if ($isTextNode(node)) {
      const text = node.getTextContent();
      segments.push({ key: node.getKey(), start: offset, length: text.length });
      append(text);
    } else {
      // Line breaks, decorators (images, embeds): they occupy space in the
      // flat string so offsets stay honest, but cannot host a caret.
      append(node.getTextContent());
    }

    spans.set(node.getKey(), { start, end: offset });
  };

  visit($getRoot());

  return { text: parts.join(''), segments, spans };
}

/** Resolve a selection point to an offset in the flat string. */
function $pointToOffset(point: PointType, flat: FlatText): number | null {
  const span = flat.spans.get(point.key);
  if (!span) return null;

  if (point.type === 'text') {
    return Math.min(span.start + point.offset, span.end);
  }

  // Element point: the offset is a child index (e.g. an empty paragraph).
  const node = $getNodeByKey(point.key);
  if (!$isElementNode(node)) return span.start;
  const children = node.getChildren();
  if (point.offset >= children.length) return span.end;
  const childSpan = flat.spans.get(children[point.offset].getKey());
  return childSpan ? childSpan.start : span.start;
}

/**
 * Move an offset in `before` to the equivalent offset in `after`.
 *
 * Each disjoint changed span is applied independently. This matters when one
 * transaction edits both sides of the caret: collapsing the whole update into
 * one common-prefix/common-suffix replacement would incorrectly treat the
 * untouched paragraph containing the caret as changed.
 */
export function mapOffsetAcrossChange(before: string, after: string, offset: number): number {
  const target = Math.min(Math.max(offset, 0), before.length);
  const changes = diffChars(before, after);
  let beforeAt = 0;
  let afterAt = 0;
  let index = 0;

  while (index < changes.length) {
    const change = changes[index];
    if (!change.added && !change.removed) {
      const length = change.value.length;
      if (target < beforeAt + length) {
        return afterAt + (target - beforeAt);
      }
      beforeAt += length;
      afterAt += length;
      index++;
      continue;
    }

    const beforeStart = beforeAt;
    const afterStart = afterAt;
    let removedLength = 0;
    let addedLength = 0;
    while (index < changes.length && (changes[index].added || changes[index].removed)) {
      const changedLength = changes[index].value.length;
      if (changes[index].removed) {
        removedLength += changedLength;
        beforeAt += changedLength;
      } else {
        addedLength += changedLength;
        afterAt += changedLength;
      }
      index++;
    }

    const beforeEnd = beforeStart + removedLength;
    const afterEnd = afterStart + addedLength;
    // A caret exactly at an insertion point stays to its left, matching the
    // previous mapper's boundary affinity.
    if (target <= beforeStart) return afterStart;
    if (target < beforeEnd) {
      return Math.min(afterStart + (target - beforeStart), afterEnd);
    }
    if (target === beforeEnd && removedLength > 0) return afterEnd;
  }

  return afterAt;
}

/** Find the TextNode that owns a flat offset. */
function locateOffset(offset: number, flat: FlatText): { key: string; offset: number } | null {
  const { segments } = flat;
  if (segments.length === 0) return null;

  for (const segment of segments) {
    if (offset <= segment.start + segment.length) {
      return {
        key: segment.key,
        offset: Math.min(Math.max(offset - segment.start, 0), segment.length),
      };
    }
  }

  const last = segments[segments.length - 1];
  return { key: last.key, offset: last.length };
}

/**
 * Build the update tags for a programmatic external content replacement.
 *
 * When the editor does NOT currently hold DOM focus (e.g. the user is typing in
 * the AI chat box while an agent edits the open file), add
 * SKIP_DOM_SELECTION_TAG so Lexical's reconciler does not move browser focus
 * and selection into the contentEditable, which would hijack the user's
 * keystrokes. When the editor IS focused, keep selection in sync.
 */
export function externalContentUpdateTags(editor: {
  getRootElement?: () => HTMLElement | null;
}): string[] {
  const tags: string[] = [SKIP_SCROLL_INTO_VIEW_TAG, EXTERNAL_CONTENT_UPDATE_TAG];
  // A headless editor throws rather than returning null here.
  let root: HTMLElement | null = null;
  try {
    root = editor.getRootElement?.() ?? null;
  } catch {
    root = null;
  }
  const editorHasFocus =
    !!root && typeof document !== 'undefined' && root.contains(document.activeElement);
  if (!editorHasFocus) {
    tags.push(SKIP_DOM_SELECTION_TAG);
  }
  return tags;
}

/**
 * Replace the editor's content with `markdown`, in place, preserving the
 * caret/selection across the change.
 *
 * Safe to call while the user is typing. Callers are responsible for not
 * calling it with content the editor already shows (an echo of the caller's own
 * save, say) -- the caret survives such a call, but the undo history does not
 * benefit from the churn.
 */
export function applyExternalMarkdown(editor: LexicalEditor, markdown: string): void {
  editor.update(
    () => {
      const before = $flattenEditorText();
      const selection = $getSelection();
      const caret = $isRangeSelection(selection)
        ? {
            anchor: $pointToOffset(selection.anchor, before),
            focus: $pointToOffset(selection.focus, before),
          }
        : null;

      // Clearing a selected node without moving selection first makes Lexical
      // throw "selection has been lost ..." (NIM-2005).
      $setSelection(null);
      $getRoot().clear();
      // Frontmatter lives in root NodeState, which `clear()` does not touch;
      // the import only overwrites it when the new markdown *has* frontmatter.
      // Drop it first so a replacement without frontmatter does not inherit
      // the old document's.
      $updateFrontmatter(null);
      $convertFromEnhancedMarkdownString(markdown, getEditorTransformers());

      if (!caret || caret.anchor === null) return;

      const after = $flattenEditorText();
      const anchorAt = locateOffset(
        mapOffsetAcrossChange(before.text, after.text, caret.anchor),
        after
      );
      if (!anchorAt) {
        // Nothing left to anchor to (e.g. the document is now empty).
        $getRoot().selectEnd();
        return;
      }
      const focusAt =
        caret.focus === null
          ? anchorAt
          : locateOffset(mapOffsetAcrossChange(before.text, after.text, caret.focus), after) ??
            anchorAt;

      const restored = $createRangeSelection();
      restored.anchor.set(anchorAt.key, anchorAt.offset, 'text');
      restored.focus.set(focusAt.key, focusAt.offset, 'text');
      $setSelection(restored);
    },
    { tag: externalContentUpdateTags(editor) }
  );
}
