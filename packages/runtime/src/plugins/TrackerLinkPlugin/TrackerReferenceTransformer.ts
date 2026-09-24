/**
 * Markdown transformer for tracker references.
 *
 * Exports `TrackerReferenceNode` as a portable markdown link
 * `[NIM-123](nimbalyst://NIM-123)` and imports any `nimbalyst://<key>` link
 * back into a `TrackerReferenceNode`. The label is display-only; the canonical
 * reference key is the URN path after `nimbalyst://`.
 * Only the `view` title attribute is persisted. Other title text/attributes
 * are discarded, and unsupported views normalize to the default chip.
 *
 * Scheme-gated so it never collides with `DocumentReferenceTransformer`, whose
 * regex explicitly excludes links containing `://`.
 */

import type { TextMatchTransformer } from '@lexical/markdown';

import {
  $createTrackerReferenceNode,
  $isTrackerReferenceNode,
  TrackerReferenceNode,
  TRACKER_REFERENCE_URN_SCHEME,
  normalizeTrackerReferenceView,
} from './TrackerReferenceNode';
import { TRACKER_REFERENCE_KEY_PATTERN } from './trackerReferenceHref';

const TRACKER_REFERENCE_IMPORT_REGEXP = new RegExp(
  String.raw`(?<!!)\[([^\]]+)\]\(nimbalyst:\/\/(${TRACKER_REFERENCE_KEY_PATTERN})(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^()]*)\)))?\s*\)`,
);
const TRACKER_REFERENCE_REGEXP = new RegExp(
  `${TRACKER_REFERENCE_IMPORT_REGEXP.source}$`,
);

export const TrackerReferenceTransformer: TextMatchTransformer = {
  dependencies: [TrackerReferenceNode],
  export: (node) => {
    if (!$isTrackerReferenceNode(node)) {
      return null;
    }
    const key = node.getReferenceKey();
    const view = node.getView();
    const title = view === 'chip' ? '' : ` "view=${view}"`;
    return `[${key}](${TRACKER_REFERENCE_URN_SCHEME}${key}${title})`;
  },
  // Match only tracker issue keys and local tracker URNs. Other nimbalyst://
  // namespaces (including action links) must remain ordinary links.
  importRegExp: TRACKER_REFERENCE_IMPORT_REGEXP,
  regExp: TRACKER_REFERENCE_REGEXP,
  replace: (textNode, match) => {
    const [, , referenceKey, doubleQuotedTitle, singleQuotedTitle, parenthesizedTitle] = match;
    const title = doubleQuotedTitle ?? singleQuotedTitle ?? parenthesizedTitle;
    const view = normalizeTrackerReferenceView(title?.match(/(?:^|\s)view=([^\s]+)(?:\s|$)/)?.[1]);
    textNode.replace($createTrackerReferenceNode(referenceKey, view));
  },
  trigger: ')',
  type: 'text-match',
};
