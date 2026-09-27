/**
 * Public types for `@nimbalyst/markdown-ydoc`. Hand-written so the package's
 * surface is these two functions, not the runtime graph behind them;
 * `src/index.ts` asserts the implementation matches.
 */

export interface MarkdownToLexicalYUpdateOptions {
  /**
   * The room's current state (`Y.encodeStateAsUpdate(doc)`). When given, the
   * markdown replaces the existing body in one transaction and the result is
   * the delta against this state. Deciding whether a non-empty body may be
   * replaced is the caller's job.
   */
  existingState?: Uint8Array;
}

/**
 * Convert markdown into a Yjs update for a Lexical collaborative document
 * (root `'main'`). Without `existingState` the update is the whole document;
 * with it, only what the replacement changed.
 */
export declare function markdownToLexicalYUpdate(
  markdown: string,
  opts?: MarkdownToLexicalYUpdateOptions,
): Uint8Array;

/** Read a Lexical collaborative document's state back out as markdown. */
export declare function lexicalYDocToMarkdown(state: Uint8Array): string;
