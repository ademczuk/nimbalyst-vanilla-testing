import type { CommentCapabilities } from '@nimbalyst/runtime/editor/commenting/types';

import type {
  CollabEditorConnectionState,
  CollabEditorServerAccess,
} from './types';

export interface CollabEditorCommentsState {
  hasConnectedOnce: boolean;
  isHydrated: boolean;
  capabilities: CommentCapabilities;
}

/**
 * Whether this user may author comments, from the two facts that decide it.
 *
 * Neither is sufficient alone, and the failure modes are opposite.
 *
 * `serverAccess` is transport-observed, and it only ever reaches `writable`
 * from a `write-acknowledged` signal -- that is, after a write the server has
 * already accepted. Deriving the gate from `serverAccess === 'writable'` alone
 * meant a writer who opened a document and had not typed yet sat at `unknown`
 * forever and never saw "Add comment" at all. That is not a race; there is no
 * later event that flips it, because `docSyncResponse` carries no
 * write-capability field and nothing else reports one.
 *
 * The host's role-derived answer is not sufficient either: it is a snapshot of
 * org policy taken from the roster, blind to a document the server has since
 * made read-only or revoked mid-session.
 *
 * Only the AND is true at both ends. `unknown` is deliberately permissive on
 * the transport side -- it means "the server has not objected", and at that
 * point the host's answer is the one carrying the authority. A viewer is still
 * refused, because the host says so.
 */
export function deriveCollabEditorCommentsState(options: {
  connection: CollabEditorConnectionState;
  serverAccess: CollabEditorServerAccess;
  hasConnectedOnce: boolean;
  /** The host's role-derived answer; see `CollabEditorCommentsOptions.canComment`. */
  hostCanComment: boolean;
}): CollabEditorCommentsState {
  const hasConnectedOnce = options.hasConnectedOnce || options.connection === 'connected';
  return {
    hasConnectedOnce,
    isHydrated: hasConnectedOnce,
    capabilities: {
      read: true,
      comment: options.hostCanComment
        && options.serverAccess !== 'read-only'
        && options.serverAccess !== 'revoked',
    },
  };
}
