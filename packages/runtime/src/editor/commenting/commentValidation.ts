import type { CommentCapabilities, CommentMember } from './types';

export const COMMENT_BOUNDS = Object.freeze({
  maxAnchorContextBytes: 512,
  maxAnchorExactBytes: 4 * 1024,
  maxBodyBytes: 32 * 1024,
  maxEntityKeyBytes: 512,
  maxMentions: 50,
  maxMutationIdCharacters: 200,
  maxPageSize: 100,
});

export type CommentControllerErrorCode =
  | 'DOCUMENT_NOT_MOUNTED'
  | 'DOCUMENT_NOT_HYDRATED'
  | 'READ_FORBIDDEN'
  | 'COMMENT_FORBIDDEN'
  | 'THREAD_NOT_FOUND'
  | 'COMMENT_NOT_FOUND'
  | 'THREAD_RESOLVED'
  | 'ANCHOR_NOT_FOUND'
  | 'ANCHOR_AMBIGUOUS'
  | 'MUTATION_CONFLICT'
  | 'BODY_TOO_LARGE'
  | 'MENTION_FORBIDDEN'
  | 'SYNC_TIMEOUT';

export class CollabCommentControllerError extends Error {
  readonly code: CommentControllerErrorCode;

  constructor(code: CommentControllerErrorCode, message: string) {
    super(message);
    this.name = 'CollabCommentControllerError';
    this.code = code;
  }
}

const textEncoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export function truncateCommentUtf8(value: string, maxBytes: number): string {
  const encoded = textEncoder.encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  return new TextDecoder().decode(encoded.slice(0, maxBytes));
}

export function normalizeVisibleCommentText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
}

export function validateCommentBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new CollabCommentControllerError(
      'BODY_TOO_LARGE',
      'Comment body must not be empty.',
    );
  }
  if (utf8ByteLength(trimmed) > COMMENT_BOUNDS.maxBodyBytes) {
    throw new CollabCommentControllerError(
      'BODY_TOO_LARGE',
      `Comment body exceeds ${COMMENT_BOUNDS.maxBodyBytes} bytes.`,
    );
  }
  return trimmed;
}

/**
 * Canonical mutation-time authorization gate for every comment surface.
 * Call immediately before mutating: hydration and capabilities can both change
 * after an authoring control was rendered.
 */
export function assertCommentMutationAllowed(
  capabilities: CommentCapabilities,
  hydrated: boolean,
): void {
  if (!hydrated) {
    throw new CollabCommentControllerError(
      'DOCUMENT_NOT_HYDRATED',
      'The collaborative document has not finished hydrating.',
    );
  }
  if (!capabilities.comment) {
    throw new CollabCommentControllerError(
      'COMMENT_FORBIDDEN',
      'You do not have permission to comment on this document.',
    );
  }
}

export function validateCommentMutationId(clientMutationId: string): string {
  const value = clientMutationId.trim();
  if (!value || value.length > COMMENT_BOUNDS.maxMutationIdCharacters) {
    throw new CollabCommentControllerError(
      'MUTATION_CONFLICT',
      `clientMutationId must be between 1 and ${COMMENT_BOUNDS.maxMutationIdCharacters} characters.`,
    );
  }
  return value;
}

export function validateCommentMentions(
  mentionedUserIds: string[] | undefined,
  members: CommentMember[],
): string[] {
  const requested = [...new Set(mentionedUserIds ?? [])];
  if (requested.length > COMMENT_BOUNDS.maxMentions) {
    throw new CollabCommentControllerError(
      'MENTION_FORBIDDEN',
      `A comment may mention at most ${COMMENT_BOUNDS.maxMentions} users.`,
    );
  }
  const allowed = new Set(members.map((member) => member.userId));
  if (requested.some((userId) => !allowed.has(userId))) {
    throw new CollabCommentControllerError(
      'MENTION_FORBIDDEN',
      'One or more mentioned users are not available in this organization.',
    );
  }
  return requested;
}

export function normalizeCommentPage(input: {
  cursor?: string;
  limit?: number;
}): { cursor: number; limit: number } {
  return {
    limit: Math.max(
      1,
      Math.min(
        COMMENT_BOUNDS.maxPageSize,
        Math.floor(input.limit ?? COMMENT_BOUNDS.maxPageSize),
      ),
    ),
    cursor: Math.max(0, Number.parseInt(input.cursor ?? '0', 10) || 0),
  };
}

export function validateTextQuoteSelector(selector: {
  exact: string;
  prefix?: string;
  suffix?: string;
}): { exact: string; prefix: string; suffix: string } {
  const exact = normalizeVisibleCommentText(selector.exact);
  const prefix = normalizeVisibleCommentText(selector.prefix ?? '');
  const suffix = normalizeVisibleCommentText(selector.suffix ?? '');

  if (!exact || utf8ByteLength(exact) > COMMENT_BOUNDS.maxAnchorExactBytes) {
    throw new CollabCommentControllerError(
      'ANCHOR_NOT_FOUND',
      `Anchor exact text must be between 1 and ${COMMENT_BOUNDS.maxAnchorExactBytes} bytes.`,
    );
  }
  if (
    utf8ByteLength(prefix) > COMMENT_BOUNDS.maxAnchorContextBytes ||
    utf8ByteLength(suffix) > COMMENT_BOUNDS.maxAnchorContextBytes
  ) {
    throw new CollabCommentControllerError(
      'ANCHOR_NOT_FOUND',
      `Anchor prefix and suffix must not exceed ${COMMENT_BOUNDS.maxAnchorContextBytes} bytes each.`,
    );
  }
  return { exact, prefix, suffix };
}
