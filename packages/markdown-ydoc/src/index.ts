/**
 * `@nimbalyst/markdown-ydoc` -- markdown <-> Lexical Y.Doc conversion for
 * hosts with no editor: the collab worker, the CLI, headless nodes.
 *
 * The conversion lives in the runtime (`runtime/src/sync/markdownYDoc.ts`),
 * beside the node classes and transformers the desktop editor uses, so there
 * is one definition of each. This package bundles it into a single ESM file
 * with no React, DOM or CSS, and carries its own copies of lexical and yjs:
 * consumers exchange Yjs updates (bytes) with it, never Y.Doc instances.
 */
import type * as Api from '../types/index';
import {
  lexicalYDocToMarkdown,
  markdownToLexicalYUpdate,
} from '../../runtime/src/sync/markdownYDoc';

// The published types are hand-written; fail the typecheck if they drift.
const _typesMatch: {
  markdownToLexicalYUpdate: typeof Api.markdownToLexicalYUpdate;
  lexicalYDocToMarkdown: typeof Api.lexicalYDocToMarkdown;
} = { markdownToLexicalYUpdate, lexicalYDocToMarkdown };
void _typesMatch;

export { lexicalYDocToMarkdown, markdownToLexicalYUpdate };
export type { MarkdownToLexicalYUpdateOptions } from '../types/index';
