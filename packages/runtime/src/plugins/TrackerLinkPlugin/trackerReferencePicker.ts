/**
 * Picker helpers for the `#` tracker-reference typeahead (V2).
 *
 * The `#` typeahead in the document editor picks an EXISTING tracker item to
 * *reference* (insert a {@link TrackerReferenceNode} pointer), rather than
 * creating a frozen inline `TrackerItemNode` snapshot. These helpers are pure
 * (search/build the option list) plus a single Lexical insertion command, kept
 * separate from the React plugin so they can be unit-tested directly.
 */

import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  type TextNode,
} from 'lexical';
import type { TrackerRecord } from '../../core/TrackerRecord';
import { $createTrackerReferenceNode, type TrackerReferenceView } from './TrackerReferenceNode';
import {
  rankTrackerReferenceCandidates,
  referenceKeyForCandidate,
  type TrackerReferenceCandidate,
  type TrackerReferenceOption,
} from './trackerReferenceSearch';

export {
  parseTypeScopedQuery,
  type TrackerReferenceOption,
} from './trackerReferenceSearch';

/** See {@link referenceKeyForCandidate}. */
export function referenceKeyForRecord(record: TrackerRecord): string {
  return referenceKeyForCandidate(record);
}

/** Map a runtime-store record to the shape the shared ranking reads. */
export function trackerRecordToCandidate(record: TrackerRecord): TrackerReferenceCandidate {
  const fields = (record.fields ?? {}) as Record<string, unknown>;
  return {
    id: record.id,
    issueKey: record.issueKey,
    issueNumber: record.issueNumber,
    title: (fields.title as string) ?? '',
    description: fields.description as string | undefined,
    status: fields.status as string | undefined,
    type: record.primaryType,
    typeTags: record.typeTags,
    archived: record.archived,
  };
}

/**
 * Match the `#…` reference trigger at the end of the given text (the block text
 * up to the caret). Allows word chars, `-` (issue keys like `NIM-13`) and `:`
 * (the `type:` scope prefix). The negative lookbehind rejects `##`/`###` so
 * markdown headings never trigger the picker.
 *
 * Returns the captured query and the full matched `#…` string (used to delete
 * the trigger text on selection), or null when there is no trigger.
 */
export function matchTrackerReferenceTrigger(
  textUpToCaret: string,
): { matchingString: string; replaceableString: string; index: number } | null {
  const m = textUpToCaret.match(/(?<!#)#([\w:-]*)$/);
  if (!m) return null;
  return { matchingString: m[1], replaceableString: m[0], index: m.index ?? 0 };
}

/**
 * Build the ordered list of reference options for the current query from
 * runtime-store records. Ranking is shared with the browser host; see
 * {@link rankTrackerReferenceCandidates}.
 */
export function buildTrackerReferenceOptions(
  records: TrackerRecord[],
  query: string | null,
  options: { typeFilter?: string | null; limit?: number } = {},
): TrackerReferenceOption[] {
  return rankTrackerReferenceCandidates(records.map(trackerRecordToCandidate), query, options);
}

/**
 * Read the `#…` trigger ending at the caret, for `TypeaheadMenuPlugin`.
 *
 * The desktop document editor runs Lexical's HashtagPlugin, so typing `#bug`
 * becomes a HashtagNode and any following `-` (issue keys) or `:` (the `type:`
 * scope) spills into a SEPARATE sibling text node. The shared
 * `getTextUpToAnchor` only reads the anchor node, so it would miss the `#` and
 * close the menu the instant you type `-`/`:`. This accumulates text backwards
 * across same-level siblings up to the caret so the `#…` trigger is seen whole.
 */
export function readTrackerReferenceTrigger(
  editor: LexicalEditor,
): { leadOffset: number; matchingString: string; replaceableString: string } | null {
  let result: { leadOffset: number; matchingString: string; replaceableString: string } | null = null;

  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

    const anchor = selection.anchor;
    if (anchor.type !== 'text') return;

    const anchorNode = anchor.getNode();
    const anchorOffset = anchor.offset;

    const anchorUpToCaret = anchorNode.getTextContent().slice(0, anchorOffset);
    let acc = anchorUpToCaret;
    let prev: LexicalNode | null = anchorNode.getPreviousSibling();
    while (prev) {
      acc = prev.getTextContent() + acc;
      prev = prev.getPreviousSibling();
    }

    const match = matchTrackerReferenceTrigger(acc);
    if (!match) return;

    // leadOffset is a DOM offset within the anchor node; clamp the matched
    // span to the part that actually lives in the anchor node (the rest is in
    // the preceding hashtag/sibling node).
    const inAnchor = Math.min(match.replaceableString.length, anchorUpToCaret.length);
    result = {
      leadOffset: anchorOffset - inAnchor,
      matchingString: match.matchingString,
      replaceableString: match.replaceableString,
    };
  });

  return result;
}

/**
 * Replace the `#query` trigger before the caret with a reference. Removes `#`
 * plus the query itself (TypeaheadMenuPlugin's single-node split can't, because
 * the trigger may span a HashtagNode plus a sibling text node), then inserts
 * the reference. The span is selected in the model, walking back across
 * sibling text nodes, rather than deleted a character at a time, which needs a
 * live DOM selection.
 */
export function $replaceTrackerReferenceTrigger(
  matchingString: string | null | undefined,
  referenceKey: string,
  view: TrackerReferenceView = 'chip',
): boolean {
  const selection = $getSelection();
  if ($isRangeSelection(selection) && selection.isCollapsed() && selection.anchor.type === 'text') {
    const caretNode = selection.anchor.getNode();
    const caretOffset = selection.anchor.offset;
    let node: TextNode = caretNode;
    let offset = caretOffset;
    let remaining = (matchingString?.length ?? 0) + 1; // +1 for '#'
    while (remaining > offset) {
      const prev = node.getPreviousSibling();
      if (!$isTextNode(prev)) {
        remaining = offset;
        break;
      }
      remaining -= offset;
      node = prev;
      offset = prev.getTextContentSize();
    }
    selection.setTextNodeRange(node, offset - remaining, caretNode, caretOffset);
    selection.removeText();
  }
  return $insertTrackerReference(referenceKey, view);
}

/**
 * Insert a tracker reference node at the current selection, followed by a
 * trailing space (so the caret has somewhere to land). Assumes the typeahead
 * has already removed the `#query` trigger text. Returns false if there is no
 * range selection.
 */
export function $insertTrackerReference(
  referenceKey: string,
  view: TrackerReferenceView = 'chip',
): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;

  const node = $createTrackerReferenceNode(referenceKey, view);
  selection.insertNodes([node]);

  const space = $createTextNode(' ');
  node.insertAfter(space);
  space.select();
  return true;
}
