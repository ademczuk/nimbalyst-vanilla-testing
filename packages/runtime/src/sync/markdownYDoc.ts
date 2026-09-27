/**
 * Markdown <-> Lexical Y.Doc conversion for hosts with no editor: the collab
 * worker, the CLI, headless Nimbalyst. Published for them as
 * `@nimbalyst/markdown-ydoc`, a Worker-safe bundle with no React, DOM or CSS.
 *
 * Produces the same document `MarkdownCollabContentAdapter.applyFromFile`
 * does -- same headless bridge, same node classes, the built-in transformer
 * set -- so a body written here opens in every editor exactly as if a desktop
 * had written it. `markdownYDoc.parity.test.ts` holds the two paths together.
 *
 * Node types the headless set has no class for (extension nodes a desktop
 * wrote) get placeholders, so such a body still reads -- the node degrades to
 * text -- and can still be replaced. See `unknownNodePlaceholders.ts`.
 *
 * The API is bytes in, bytes out on purpose. The bundle carries its own copy
 * of yjs, and a Y.Doc from the caller's copy would fail yjs's constructor
 * checks here. Updates are the portable form.
 */
import { $getRoot } from 'lexical';
import { applyUpdate, Doc, encodeStateAsUpdate, encodeStateVector, XmlText } from 'yjs';

import { $convertToEnhancedMarkdownString } from '../editor/markdown/EnhancedMarkdownExport';
import { $convertFromEnhancedMarkdownString } from '../editor/markdown/EnhancedMarkdownImport';
import { getHeadlessBodyTransformers } from '../editor/markdown/headlessBodyTransformers';
import { HeadlessBodyNodes } from '../editor/nodes/headlessBodyNodes';
import type { HeadlessLexicalYDoc } from './HeadlessLexicalYDoc';
import { withUnknownNodePlaceholders } from './unknownNodePlaceholders';
import { withHeadlessLexicalBridge } from './withHeadlessLexicalBridge';

export interface MarkdownToLexicalYUpdateOptions {
  /**
   * The room's current state (`Y.encodeStateAsUpdate(doc)`). When given, the
   * markdown replaces the existing body in one transaction, as
   * `applyFromFile` does, and the result is the delta against this state.
   * Deciding whether a non-empty body may be replaced is the caller's job.
   */
  existingState?: Uint8Array;
}

/**
 * `HeadlessLexicalYDoc` turns a failed materialization into an empty editor
 * and a console warning. Here that would read a real body as '' or replace
 * nothing, so a non-empty tree that hydrates to nothing is an error.
 */
function assertHydrated(doc: Doc, headless: HeadlessLexicalYDoc): void {
  if (doc.get('root', XmlText).length === 0) return;
  if (headless.editor.getEditorState().read(() => $getRoot().isEmpty())) {
    throw new Error('markdown-ydoc: the existing document could not be decoded');
  }
}

function $replaceRootWithMarkdown(markdown: string): void {
  $getRoot().clear();
  $convertFromEnhancedMarkdownString(markdown, getHeadlessBodyTransformers());
}

/**
 * Convert markdown into a Yjs update for a Lexical collaborative document
 * (root `'main'`). Without `existingState` the update is the whole document;
 * with it, the update is only what the replacement changed.
 */
export function markdownToLexicalYUpdate(
  markdown: string,
  opts: MarkdownToLexicalYUpdateOptions = {},
): Uint8Array {
  const doc = new Doc();
  try {
    if (opts.existingState) applyUpdate(doc, opts.existingState);
    const before = encodeStateVector(doc);
    const nodes = withUnknownNodePlaceholders(doc, HeadlessBodyNodes);
    withHeadlessLexicalBridge(doc, { nodes }, (headless) => {
      assertHydrated(doc, headless);
      headless.applyUpdate(() => $replaceRootWithMarkdown(markdown));
    });
    return encodeStateAsUpdate(doc, before);
  } finally {
    doc.destroy();
  }
}

/** Read a Lexical collaborative document's state back out as markdown. */
export function lexicalYDocToMarkdown(state: Uint8Array): string {
  const doc = new Doc();
  try {
    applyUpdate(doc, state);
    const nodes = withUnknownNodePlaceholders(doc, HeadlessBodyNodes);
    return withHeadlessLexicalBridge(doc, { nodes }, (headless) => {
      assertHydrated(doc, headless);
      return headless.editor.getEditorState().read(() =>
        $convertToEnhancedMarkdownString(getHeadlessBodyTransformers()),
      );
    });
  } finally {
    doc.destroy();
  }
}
