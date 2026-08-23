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

export interface DocumentCommentAccessInput {
  orgId?: string | null;
  projectId?: string | null;
}

export type DocumentCommentAccessCheck = (input: DocumentCommentAccessInput & {
  action: 'view' | 'edit' | 'admin';
}) => Promise<{ allowed: boolean }>;

/**
 * Resolve the desktop host's comment capability without borrowing edit access.
 * Project view is the platform permission for reading and annotating a mockup;
 * editing its HTML remains a separate action.
 */
export async function resolveDocumentCommentCapabilities(
  canAccess: DocumentCommentAccessCheck,
  input: DocumentCommentAccessInput,
): Promise<CommentCapabilities> {
  const readAccess = await canAccess({ ...input, action: 'view' });
  return {
    read: readAccess.allowed,
    comment: readAccess.allowed,
  };
}

/**
 * Whether this user may author comments, from the two facts that decide it.
 *
 * Neither is sufficient alone, and the failure modes are opposite.
 *
 * The host's role-derived answer is only a local projection. It cannot grant
 * access while the server verdict is unknown, because the document may have
 * been downgraded since that projection was populated. Comment authoring is
 * therefore available only after the transport has authoritative positive
 * evidence. Every unavailable or negative server state fails closed.
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
      comment: options.hostCanComment && options.serverAccess === 'writable',
    },
  };
}
