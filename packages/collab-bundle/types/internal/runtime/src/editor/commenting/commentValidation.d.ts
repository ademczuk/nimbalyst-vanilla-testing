import type { CommentCapabilities, CommentMember } from './types';
export declare const COMMENT_BOUNDS: Readonly<{
    maxAnchorContextBytes: 512;
    maxAnchorExactBytes: number;
    maxBodyBytes: number;
    maxEntityKeyBytes: 512;
    maxMentions: 50;
    maxMutationIdCharacters: 200;
    maxPageSize: 100;
}>;
export type CommentControllerErrorCode = 'DOCUMENT_NOT_MOUNTED' | 'DOCUMENT_NOT_HYDRATED' | 'READ_FORBIDDEN' | 'COMMENT_FORBIDDEN' | 'THREAD_NOT_FOUND' | 'COMMENT_NOT_FOUND' | 'THREAD_RESOLVED' | 'ANCHOR_NOT_FOUND' | 'ANCHOR_AMBIGUOUS' | 'MUTATION_CONFLICT' | 'BODY_TOO_LARGE' | 'MENTION_FORBIDDEN' | 'SYNC_TIMEOUT';
export declare class CollabCommentControllerError extends Error {
    readonly code: CommentControllerErrorCode;
    constructor(code: CommentControllerErrorCode, message: string);
}
export declare function utf8ByteLength(value: string): number;
export declare function truncateCommentUtf8(value: string, maxBytes: number): string;
export declare function normalizeVisibleCommentText(value: string): string;
export declare function validateCommentBody(body: string): string;
/**
 * Canonical mutation-time authorization gate for every comment surface.
 * Call immediately before mutating: hydration and capabilities can both change
 * after an authoring control was rendered.
 */
export declare function assertCommentMutationAllowed(capabilities: CommentCapabilities, hydrated: boolean): void;
export declare function validateCommentMutationId(clientMutationId: string): string;
export declare function validateCommentMentions(mentionedUserIds: string[] | undefined, members: CommentMember[]): string[];
export declare function normalizeCommentPage(input: {
    cursor?: string;
    limit?: number;
}): {
    cursor: number;
    limit: number;
};
export declare function validateTextQuoteSelector(selector: {
    exact: string;
    prefix?: string;
    suffix?: string;
}): {
    exact: string;
    prefix: string;
    suffix: string;
};
