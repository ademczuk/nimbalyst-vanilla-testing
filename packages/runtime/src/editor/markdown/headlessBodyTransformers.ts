/**
 * The markdown transformer set for writing and reading document bodies where
 * no editor runs: the collab worker, the CLI, headless Nimbalyst.
 *
 * It is the built-in half of what `MarkdownCollabContentAdapter` sees in the
 * renderer, as a fixed list instead of the live extension store (which imports
 * React and changes as extensions load). Order matches that adapter: the
 * reference transformers first, then the built-in extension transformers in
 * `registerBuiltinExtensions` order, then `CORE_TRANSFORMERS`.
 *
 * Deliberately absent:
 *   - Extension-donated transformers (math, data models, ...). Their syntax
 *     stays literal text; the editor that owns them upgrades it when it loads.
 *   - Collapsible and kanban-board transformers. Their nodes are not in
 *     `HeadlessBodyNodes`, so the adapter aborts on that markdown today; here
 *     it stays text instead.
 *
 * Table cells convert with this same list. The editor's `TABLE_TRANSFORMER`
 * reads the live store instead: the same built-in transformers, with the
 * reference ones after the extension ones rather than first.
 *
 * Must stay React-, DOM- and CSS-free; `@nimbalyst/markdown-ydoc` bundles it
 * for Workers.
 */
import type { Transformer } from '@lexical/markdown';

import {
  CollabDocumentReferenceTransformer,
  DocumentReferenceTransformer,
  LegacyDocumentReferenceTransformer,
} from '../../plugins/DocumentLinkPlugin/DocumentLinkNode';
import { TrackerReferenceTransformer } from '../../plugins/TrackerLinkPlugin/TrackerReferenceTransformer';
import { DECISION_TRANSFORMER } from '../plugins/DecisionPlugin/DecisionTransformer';
import { EMBED_TRANSFORMER } from '../plugins/EmbedPlugin/EmbedTransformer';
import { EMOJI_TRANSFORMER } from '../plugins/EmojisPlugin/EmojiTransformer';
import { IMAGE_TRANSFORMER } from '../plugins/ImagesPlugin/ImageTransformer';
import { MERMAID_TRANSFORMER } from '../plugins/MermaidPlugin/MermaidTransformer';
import { PAGE_BREAK_TRANSFORMER } from '../plugins/PageBreakPlugin/PageBreakTransformer';
import { createTableTransformer } from '../plugins/TablePlugin/createTableTransformer';
import { CORE_TRANSFORMERS } from './core-transformers';

const HEADLESS_TABLE_TRANSFORMER = createTableTransformer(() => HEADLESS_BODY_TRANSFORMERS);

const HEADLESS_BODY_TRANSFORMERS: Transformer[] = [
  // Must precede TrackerReferenceTransformer, whose nimbalyst:// matcher is
  // intentionally broad enough to otherwise claim shared-document links.
  CollabDocumentReferenceTransformer,
  TrackerReferenceTransformer,
  DocumentReferenceTransformer,
  LegacyDocumentReferenceTransformer,
  DECISION_TRANSFORMER,
  EMOJI_TRANSFORMER,
  IMAGE_TRANSFORMER,
  MERMAID_TRANSFORMER,
  PAGE_BREAK_TRANSFORMER,
  HEADLESS_TABLE_TRANSFORMER,
  EMBED_TRANSFORMER,
  ...CORE_TRANSFORMERS,
];

export function getHeadlessBodyTransformers(): Transformer[] {
  return HEADLESS_BODY_TRANSFORMERS;
}
