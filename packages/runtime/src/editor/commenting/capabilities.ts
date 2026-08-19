/**
 * Resolving a host's document-comment capabilities.
 *
 * `CommentsConfig.getCapabilities` is optional, and an absent resolver means
 * "this host does not model per-document comment access" -- not "commenting is
 * forbidden". Every desktop host either answers `{ read: true, comment: true }`
 * or omits the resolver entirely, because reaching a mounted collaborative
 * editor there already implies write authorization. Defaulting closed would
 * silently remove the comment UI from those hosts, so the default is open.
 *
 * A host that *does* answer is authoritative, `false` included. That is the
 * seam the web console needs: its org `viewer` and `guest` roles are rejected
 * server-side (`document_comment_forbidden`), so an authoring affordance shown
 * to them writes into the Y.Doc and loses the thread on reload.
 *
 * Never cache the result. Access can be revoked mid-session while the config
 * object carrying the resolver keeps its identity, so a value memoized on that
 * identity would leave the gate decorative exactly when it matters.
 */

import type { CommentCapabilities, CommentsConfig } from './types';

/** Applied when the host supplies no `getCapabilities` resolver. */
export const DEFAULT_COMMENT_CAPABILITIES: CommentCapabilities = {
  read: true,
  comment: true,
};

type CapabilitySource = Pick<CommentsConfig, 'getCapabilities'>;

export function resolveCommentCapabilities(
  config: CapabilitySource | undefined,
): CommentCapabilities {
  return config?.getCapabilities?.() ?? DEFAULT_COMMENT_CAPABILITIES;
}

/**
 * Whether the current user may author comments. Call at render time *and*
 * again at mutation time; see the caching note above.
 */
export function canAuthorComments(config: CapabilitySource | undefined): boolean {
  return resolveCommentCapabilities(config).comment;
}
