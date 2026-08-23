import { Map as YMap, type Doc } from 'yjs';
import type { Comment, CommentActor, CommentAnchor, Comments, Thread } from './types';
export type CommentAnchorSupport = 'supported' | 'unsupported';
export type CommentSnapshot = Readonly<Comment>;
export type ThreadSnapshot = Readonly<Omit<Thread, 'comments'>> & {
    readonly comments: ReadonlyArray<CommentSnapshot>;
};
export type CommentRepositorySnapshot = ReadonlyArray<CommentSnapshot | ThreadSnapshot>;
export type CreateCommentOptions = {
    actor?: CommentActor;
    clientMutationId?: string;
    deleted?: boolean;
    id?: string;
    replyToCommentId?: string;
    timeStamp?: number;
};
export type RepositoryMutationResult<T> = {
    duplicate: boolean;
    value: T;
};
export declare class CommentRepositoryMutationError extends Error {
    readonly code: 'ANCHOR_INVALID' | 'ANCHOR_UNSUPPORTED' | 'MUTATION_CONFLICT';
    constructor(code: 'ANCHOR_INVALID' | 'ANCHOR_UNSUPPORTED' | 'MUTATION_CONFLICT', message: string);
}
export declare function normalizeCommentActor(actor: unknown, fallbackAuthor: string): CommentActor;
export declare function createComment(content: string, author: string, options?: CreateCommentOptions): Comment;
export declare function createComment(content: string, author: string, id?: string, timeStamp?: number, deleted?: boolean, options?: Omit<CreateCommentOptions, 'id' | 'timeStamp' | 'deleted'>): Comment;
export declare function createThread(quote: string, comments: Array<Comment>, id?: string, resolved?: boolean, anchor?: CommentAnchor): Thread;
export declare function getCommentAnchorSupport(anchor: unknown): CommentAnchorSupport;
export declare function materializeSharedComment(map: YMap<unknown>): Comment | Thread;
export declare function createCommentSharedMap(commentOrThread: Comment | Thread): YMap<unknown>;
export declare class YDocCommentRepository {
    private readonly doc;
    private readonly sharedComments;
    private readonly listeners;
    private snapshot;
    constructor(doc: Doc);
    getSnapshot(): CommentRepositorySnapshot;
    subscribe(listener: () => void): () => void;
    destroy(): void;
    addThread(thread: Thread, offset?: number): RepositoryMutationResult<ThreadSnapshot>;
    appendReply(threadId: string, comment: Comment, offset?: number): RepositoryMutationResult<CommentSnapshot>;
    addTopLevelComment(comment: Comment, offset?: number): CommentSnapshot;
    deleteThread(threadId: string): boolean;
    deleteTopLevelComment(commentId: string): {
        index: number;
        markedComment: Comment;
    } | null;
    deleteComment(threadId: string, commentId: string): {
        index: number;
        markedComment: Comment;
    } | null;
    setThreadResolved(threadId: string, resolved: boolean): boolean;
    createSharedMap(commentOrThread: Comment | Thread): YMap<unknown>;
    private readonly handleSharedChanges;
    private materializeSnapshot;
    private findThreadIndex;
    private findThreadMap;
    private requireThread;
    private findMutation;
}
export declare function asComments(snapshot: CommentRepositorySnapshot): Comments;
