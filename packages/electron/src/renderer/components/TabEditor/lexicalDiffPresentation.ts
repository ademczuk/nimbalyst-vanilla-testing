/**
 * Whether a pending generation can afford an inline Lexical diff.
 *
 * The matcher aligns siblings with an O(m*n) cost matrix, so a document with
 * thousands of top-level blocks on each side blocks the renderer main thread for
 * tens of seconds and then dies on V8's Map size cap (#4821). Bytes are the
 * wrong proxy for that -- 194KB of prose is a handful of nodes, 194KB of bullets
 * is thousands -- so the byte check is only a cheap pre-filter and the real guard
 * counts root nodes after the baseline has been parsed.
 *
 * The decision lives here, away from the editor, because it is the half that can
 * be tested: both call sites in `TabEditor` do nothing but parse and then ask.
 * Declining inline rendering is a *presentation* outcome, never a resolution --
 * the caller must still put the agent's bytes in the buffer, keep the approval
 * bar and the pending tag, and report `presented-without-inline` (NIM-5359).
 */

/** Cheap pre-filter, applied before either side is parsed. */
export const LEXICAL_DIFF_MAX_BYTES = 200_000;

/**
 * Sits under the runtime's DEFAULT_MAX_PAIR_EVALUATIONS budget
 * (1200 x 1200 = 1.44M of 2M cells), leaving headroom for the nested child
 * alignments inside those blocks.
 */
export const LEXICAL_DIFF_MAX_ROOT_NODES = 1200;

export type LexicalDiffPresentationDecision =
  /** Render the inline diff. */
  | { presentation: 'inline' }
  /** Too expensive to render inline; `reason` is log-shaped. */
  | { presentation: 'no-inline-fallback'; reason: string };

const INLINE: LexicalDiffPresentationDecision = { presentation: 'inline' };

/**
 * Byte pre-filter. `inline` here means "cheap enough to parse", not "cheap
 * enough to diff" -- the caller must still ask `decideLexicalDiffByRootNodes`
 * once the baseline is parsed.
 */
export function decideLexicalDiffByBytes(
  oldContent: string,
  newContent: string,
): LexicalDiffPresentationDecision {
  const oldLen = oldContent?.length ?? 0;
  const newLen = newContent?.length ?? 0;
  if (oldLen > LEXICAL_DIFF_MAX_BYTES || newLen > LEXICAL_DIFF_MAX_BYTES) {
    return {
      presentation: 'no-inline-fallback',
      reason: `oldLen=${oldLen} newLen=${newLen} byteThreshold=${LEXICAL_DIFF_MAX_BYTES}`,
    };
  }
  return INLINE;
}

/** The real guard, applied after the baseline has been parsed into root nodes. */
export function decideLexicalDiffByRootNodes(
  oldRootNodeCount: number,
): LexicalDiffPresentationDecision {
  if (oldRootNodeCount > LEXICAL_DIFF_MAX_ROOT_NODES) {
    return {
      presentation: 'no-inline-fallback',
      reason: `rootNodes=${oldRootNodeCount} nodeThreshold=${LEXICAL_DIFF_MAX_ROOT_NODES}`,
    };
  }
  return INLINE;
}
