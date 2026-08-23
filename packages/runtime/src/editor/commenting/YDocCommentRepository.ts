import { Array as YArray, Map as YMap, type Doc } from 'yjs';

import type {
  Comment,
  CommentActor,
  CommentAnchor,
  Comments,
  Thread,
} from './types';
import { COMMENT_BOUNDS, utf8ByteLength } from './commentValidation';

export type CommentAnchorSupport = 'supported' | 'unsupported';

export type CommentSnapshot = Readonly<Comment>;
export type ThreadSnapshot = Readonly<Omit<Thread, 'comments'>> & {
  readonly comments: ReadonlyArray<CommentSnapshot>;
};
export type CommentRepositorySnapshot = ReadonlyArray<
  CommentSnapshot | ThreadSnapshot
>;

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

export class CommentRepositoryMutationError extends Error {
  readonly code: 'ANCHOR_INVALID' | 'ANCHOR_UNSUPPORTED' | 'MUTATION_CONFLICT';

  constructor(
    code: 'ANCHOR_INVALID' | 'ANCHOR_UNSUPPORTED' | 'MUTATION_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'CommentRepositoryMutationError';
    this.code = code;
  }
}

function createUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, '')
    .substring(0, 12);
}

function isCreateCommentOptions(
  value: string | CreateCommentOptions | undefined,
): value is CreateCommentOptions {
  return typeof value === 'object' && value !== null;
}

export function normalizeCommentActor(
  actor: unknown,
  fallbackAuthor: string,
): CommentActor {
  if (actor && typeof actor === 'object') {
    const value = actor as Record<string, unknown>;
    if (
      value.kind === 'agent' &&
      typeof value.sessionId === 'string' &&
      typeof value.sessionName === 'string' &&
      typeof value.onBehalfOfUserId === 'string'
    ) {
      return {
        kind: 'agent',
        sessionId: value.sessionId,
        sessionName: value.sessionName,
        onBehalfOfUserId: value.onBehalfOfUserId,
        ...(typeof value.onBehalfOfDisplayName === 'string'
          ? { onBehalfOfDisplayName: value.onBehalfOfDisplayName }
          : {}),
      };
    }
    if (value.kind === 'user' && typeof value.displayName === 'string') {
      return {
        kind: 'user',
        displayName: value.displayName,
        ...(typeof value.userId === 'string' ? { userId: value.userId } : {}),
      };
    }
  }
  return { kind: 'user', displayName: fallbackAuthor };
}

export function createComment(
  content: string,
  author: string,
  options?: CreateCommentOptions,
): Comment;
export function createComment(
  content: string,
  author: string,
  id?: string,
  timeStamp?: number,
  deleted?: boolean,
  options?: Omit<CreateCommentOptions, 'id' | 'timeStamp' | 'deleted'>,
): Comment;
export function createComment(
  content: string,
  author: string,
  idOrOptions?: string | CreateCommentOptions,
  timeStamp?: number,
  deleted?: boolean,
  options?: Omit<CreateCommentOptions, 'id' | 'timeStamp' | 'deleted'>,
): Comment {
  const normalizedOptions = isCreateCommentOptions(idOrOptions)
    ? idOrOptions
    : {
        ...options,
        id: idOrOptions,
        timeStamp,
        deleted,
      };
  return {
    ...(normalizedOptions.actor ? { actor: normalizedOptions.actor } : {}),
    author,
    ...(normalizedOptions.clientMutationId
      ? { clientMutationId: normalizedOptions.clientMutationId }
      : {}),
    content,
    deleted:
      normalizedOptions.deleted === undefined
        ? false
        : normalizedOptions.deleted,
    id: normalizedOptions.id === undefined ? createUID() : normalizedOptions.id,
    ...(normalizedOptions.replyToCommentId
      ? { replyToCommentId: normalizedOptions.replyToCommentId }
      : {}),
    timeStamp:
      normalizedOptions.timeStamp === undefined
        ? performance.timeOrigin + performance.now()
        : normalizedOptions.timeStamp,
    type: 'comment',
  };
}

export function createThread(
  quote: string,
  comments: Array<Comment>,
  id?: string,
  resolved?: boolean,
  anchor?: CommentAnchor,
): Thread {
  return {
    comments,
    id: id === undefined ? createUID() : id,
    quote,
    ...(anchor === undefined ? {} : { anchor }),
    // Threads created before resolve support have no `resolved` field.
    resolved: resolved === undefined ? false : resolved,
    type: 'thread',
  };
}

function markDeleted(comment: Comment): Comment {
  return {
    ...(comment.actor ? { actor: comment.actor } : {}),
    author: comment.author,
    ...(comment.clientMutationId
      ? { clientMutationId: comment.clientMutationId }
      : {}),
    content: '[Deleted Comment]',
    deleted: true,
    id: comment.id,
    ...(comment.replyToCommentId
      ? { replyToCommentId: comment.replyToCommentId }
      : {}),
    timeStamp: comment.timeStamp,
    type: 'comment',
  };
}

function isOptionalBoundedString(value: unknown, maxBytes: number): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' && utf8ByteLength(value) <= maxBytes)
  );
}

export function getCommentAnchorSupport(anchor: unknown): CommentAnchorSupport {
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) {
    return 'unsupported';
  }
  const value = anchor as Record<string, unknown>;
  if (value.kind === 'text-quote') {
    return typeof value.exact === 'string' &&
      value.exact.length > 0 &&
      utf8ByteLength(value.exact) <= COMMENT_BOUNDS.maxAnchorExactBytes &&
      isOptionalBoundedString(
        value.prefix,
        COMMENT_BOUNDS.maxAnchorContextBytes,
      ) &&
      isOptionalBoundedString(
        value.suffix,
        COMMENT_BOUNDS.maxAnchorContextBytes,
      )
      ? 'supported'
      : 'unsupported';
  }
  if (value.kind === 'entity') {
    return typeof value.entityType === 'string' &&
      value.entityType.length > 0 &&
      utf8ByteLength(value.entityType) <= COMMENT_BOUNDS.maxEntityKeyBytes &&
      typeof value.entityId === 'string' &&
      value.entityId.length > 0 &&
      utf8ByteLength(value.entityId) <= COMMENT_BOUNDS.maxEntityKeyBytes &&
      isOptionalBoundedString(value.field, COMMENT_BOUNDS.maxEntityKeyBytes) &&
      isOptionalBoundedString(
        value.labelSnapshot,
        COMMENT_BOUNDS.maxAnchorExactBytes,
      )
      ? 'supported'
      : 'unsupported';
  }
  return 'unsupported';
}

function assertAnchorCanPersist(anchor: unknown): void {
  if (
    anchor &&
    typeof anchor === 'object' &&
    !Array.isArray(anchor) &&
    !['text-quote', 'entity'].includes(
      String((anchor as Record<string, unknown>).kind),
    )
  ) {
    throw new CommentRepositoryMutationError(
      'ANCHOR_UNSUPPORTED',
      'Unknown comment anchor kinds cannot be authored by this client.',
    );
  }
  if (getCommentAnchorSupport(anchor) !== 'supported') {
    throw new CommentRepositoryMutationError(
      'ANCHOR_INVALID',
      'The comment anchor is malformed or exceeds its encoded size limit.',
    );
  }
}

function cloneStoredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneStoredValue);
  }
  if (value && typeof value === 'object') {
    if (value instanceof YMap || value instanceof YArray) {
      return cloneStoredValue(value.toJSON());
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        cloneStoredValue(child),
      ]),
    );
  }
  return value;
}

function freezeStoredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    value.forEach(freezeStoredValue);
    return Object.freeze(value);
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeStoredValue);
    return Object.freeze(value);
  }
  return value;
}

function freezeComment(comment: Comment): CommentSnapshot {
  if (comment.actor) Object.freeze(comment.actor);
  return Object.freeze(comment);
}

function freezeThread(thread: Thread): ThreadSnapshot {
  thread.comments.forEach(freezeComment);
  Object.freeze(thread.comments);
  if (thread.anchor !== undefined) {
    freezeStoredValue(thread.anchor);
  }
  return Object.freeze(thread) as ThreadSnapshot;
}

function materializeComment(map: YMap<unknown>): Comment {
  const author = map.get('author') as string;
  return createComment(
    map.get('content') as string,
    author,
    map.get('id') as string,
    map.get('timeStamp') as number,
    map.get('deleted') as boolean,
    {
      actor: normalizeCommentActor(map.get('actor'), author),
      clientMutationId: map.get('clientMutationId') as string | undefined,
      replyToCommentId: map.get('replyToCommentId') as string | undefined,
    },
  );
}

export function materializeSharedComment(map: YMap<unknown>): Comment | Thread {
  if (map.get('type') !== 'thread') {
    return materializeComment(map);
  }
  const sharedChildren = map.get('comments');
  const comments =
    sharedChildren instanceof YArray
      ? sharedChildren
          .toArray()
          .filter((value): value is YMap<unknown> => value instanceof YMap)
          .map(materializeComment)
      : [];
  const rawAnchor = map.has('anchor')
    ? freezeStoredValue(cloneStoredValue(map.get('anchor')))
    : undefined;
  return createThread(
    map.get('quote') as string,
    comments,
    map.get('id') as string,
    map.get('resolved') as boolean | undefined,
    // Unknown future kinds intentionally survive materialization. Consumers
    // report them through getCommentAnchorSupport instead of guessing.
    rawAnchor as CommentAnchor | undefined,
  );
}

export function createCommentSharedMap(
  commentOrThread: Comment | Thread,
): YMap<unknown> {
  const sharedMap = new YMap<unknown>();
  sharedMap.set('type', commentOrThread.type);
  sharedMap.set('id', commentOrThread.id);
  if (commentOrThread.type === 'comment') {
    if (commentOrThread.actor) sharedMap.set('actor', commentOrThread.actor);
    sharedMap.set('author', commentOrThread.author);
    if (commentOrThread.clientMutationId) {
      sharedMap.set('clientMutationId', commentOrThread.clientMutationId);
    }
    sharedMap.set('content', commentOrThread.content);
    sharedMap.set('deleted', commentOrThread.deleted);
    if (commentOrThread.replyToCommentId) {
      sharedMap.set('replyToCommentId', commentOrThread.replyToCommentId);
    }
    sharedMap.set('timeStamp', commentOrThread.timeStamp);
    return sharedMap;
  }

  sharedMap.set('quote', commentOrThread.quote);
  if (commentOrThread.anchor !== undefined) {
    assertAnchorCanPersist(commentOrThread.anchor);
    sharedMap.set('anchor', cloneStoredValue(commentOrThread.anchor));
  }
  sharedMap.set('resolved', commentOrThread.resolved);
  const commentsArray = new YArray<YMap<unknown>>();
  commentOrThread.comments.forEach((comment, index) => {
    commentsArray.insert(index, [createCommentSharedMap(comment)]);
  });
  sharedMap.set('comments', commentsArray);
  return sharedMap;
}

function commentsMatch(left: Comment, right: Comment): boolean {
  return (
    left.author === right.author &&
    left.content === right.content &&
    left.deleted === right.deleted &&
    left.replyToCommentId === right.replyToCommentId &&
    JSON.stringify(normalizeCommentActor(left.actor, left.author)) ===
      JSON.stringify(normalizeCommentActor(right.actor, right.author))
  );
}

export class YDocCommentRepository {
  private readonly doc: Doc;
  private readonly sharedComments: YArray<YMap<unknown>>;
  private readonly listeners = new Set<() => void>();
  private snapshot: CommentRepositorySnapshot;

  constructor(doc: Doc) {
    this.doc = doc;
    this.sharedComments = doc.getArray<YMap<unknown>>('comments');
    this.snapshot = this.materializeSnapshot();
    this.sharedComments.observeDeep(this.handleSharedChanges);
  }

  getSnapshot(): CommentRepositorySnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.sharedComments.unobserveDeep(this.handleSharedChanges);
    this.listeners.clear();
  }

  addThread(
    thread: Thread,
    offset = this.sharedComments.length,
  ): RepositoryMutationResult<ThreadSnapshot> {
    for (const initialComment of thread.comments) {
      const duplicate = initialComment.clientMutationId
        ? this.findMutation(initialComment.clientMutationId)
        : undefined;
      if (!duplicate) continue;
      if (
        duplicate.thread.quote !== thread.quote ||
        !commentsMatch(duplicate.comment, initialComment)
      ) {
        throw new CommentRepositoryMutationError(
          'MUTATION_CONFLICT',
          'clientMutationId was already used for a different comment mutation.',
        );
      }
      return { duplicate: true, value: duplicate.thread };
    }

    this.doc.transact(() => {
      this.sharedComments.insert(offset, [createCommentSharedMap(thread)]);
    }, this);
    return {
      duplicate: false,
      value: this.requireThread(thread.id),
    };
  }

  appendReply(
    threadId: string,
    comment: Comment,
    offset?: number,
  ): RepositoryMutationResult<CommentSnapshot> {
    if (comment.clientMutationId) {
      const duplicate = this.findMutation(comment.clientMutationId);
      if (duplicate) {
        if (
          duplicate.thread.id !== threadId ||
          !commentsMatch(duplicate.comment, comment)
        ) {
          throw new CommentRepositoryMutationError(
            'MUTATION_CONFLICT',
            'clientMutationId was already used for a different comment mutation.',
          );
        }
        return { duplicate: true, value: duplicate.comment };
      }
    }

    const threadMap = this.findThreadMap(threadId);
    const comments = threadMap?.get('comments');
    if (!(comments instanceof YArray)) {
      throw new Error(`Comment thread ${threadId} was not found.`);
    }
    const insertOffset = offset ?? comments.length;
    this.doc.transact(() => {
      comments.insert(insertOffset, [createCommentSharedMap(comment)]);
    }, this);
    const inserted = this.requireThread(threadId).comments.find(
      (candidate) => candidate.id === comment.id,
    );
    if (!inserted) throw new Error(`Comment ${comment.id} was not inserted.`);
    return { duplicate: false, value: inserted };
  }

  addTopLevelComment(
    comment: Comment,
    offset = this.sharedComments.length,
  ): CommentSnapshot {
    this.doc.transact(() => {
      this.sharedComments.insert(offset, [createCommentSharedMap(comment)]);
    }, this);
    const inserted = this.snapshot.find(
      (candidate) =>
        candidate.type === 'comment' && candidate.id === comment.id,
    );
    if (!inserted || inserted.type !== 'comment') {
      throw new Error(`Comment ${comment.id} was not inserted.`);
    }
    return inserted;
  }

  deleteThread(threadId: string): boolean {
    const index = this.findThreadIndex(threadId);
    if (index === -1) return false;
    this.doc.transact(() => this.sharedComments.delete(index), this);
    return true;
  }

  deleteTopLevelComment(
    commentId: string,
  ): { index: number; markedComment: Comment } | null {
    const index = this.snapshot.findIndex(
      (candidate) => candidate.type === 'comment' && candidate.id === commentId,
    );
    const comment = this.snapshot[index];
    if (index === -1 || !comment || comment.type !== 'comment') return null;
    this.doc.transact(() => this.sharedComments.delete(index), this);
    return {
      index,
      markedComment: markDeleted(comment as Comment),
    };
  }

  deleteComment(
    threadId: string,
    commentId: string,
  ): { index: number; markedComment: Comment } | null {
    const thread = this.snapshot.find(
      (candidate): candidate is ThreadSnapshot =>
        candidate.type === 'thread' && candidate.id === threadId,
    );
    const commentIndex =
      thread?.comments.findIndex((comment) => comment.id === commentId) ?? -1;
    if (!thread || commentIndex === -1) return null;
    const threadMap = this.findThreadMap(threadId);
    const comments = threadMap?.get('comments');
    if (!(comments instanceof YArray)) return null;
    this.doc.transact(() => comments.delete(commentIndex), this);
    return {
      index: commentIndex,
      markedComment: markDeleted(thread.comments[commentIndex] as Comment),
    };
  }

  setThreadResolved(threadId: string, resolved: boolean): boolean {
    const thread = this.snapshot.find(
      (candidate): candidate is ThreadSnapshot =>
        candidate.type === 'thread' && candidate.id === threadId,
    );
    if (!thread || thread.resolved === resolved) return false;
    const threadMap = this.findThreadMap(threadId);
    if (!threadMap) return false;
    this.doc.transact(() => threadMap.set('resolved', resolved), this);
    return true;
  }

  createSharedMap(commentOrThread: Comment | Thread): YMap<unknown> {
    return createCommentSharedMap(commentOrThread);
  }

  private readonly handleSharedChanges = (): void => {
    this.snapshot = this.materializeSnapshot();
    for (const listener of this.listeners) listener();
  };

  private materializeSnapshot(): CommentRepositorySnapshot {
    const comments = this.sharedComments
      .toArray()
      .filter((value): value is YMap<unknown> => value instanceof YMap)
      .map(materializeSharedComment)
      .map((value) =>
        value.type === 'thread' ? freezeThread(value) : freezeComment(value),
      );
    return Object.freeze(comments);
  }

  private findThreadIndex(threadId: string): number {
    return this.sharedComments
      .toArray()
      .findIndex(
        (value) =>
          value instanceof YMap &&
          value.get('type') === 'thread' &&
          value.get('id') === threadId,
      );
  }

  private findThreadMap(threadId: string): YMap<unknown> | undefined {
    const index = this.findThreadIndex(threadId);
    if (index === -1) return undefined;
    const value = this.sharedComments.get(index);
    return value instanceof YMap ? value : undefined;
  }

  private requireThread(threadId: string): ThreadSnapshot {
    const thread = this.snapshot.find(
      (candidate): candidate is ThreadSnapshot =>
        candidate.type === 'thread' && candidate.id === threadId,
    );
    if (!thread) throw new Error(`Comment thread ${threadId} was not found.`);
    return thread;
  }

  private findMutation(
    clientMutationId: string,
  ): { comment: CommentSnapshot; thread: ThreadSnapshot } | undefined {
    for (const candidate of this.snapshot) {
      if (candidate.type !== 'thread') continue;
      const comment = candidate.comments.find(
        (value) => value.clientMutationId === clientMutationId,
      );
      if (comment) return { comment, thread: candidate };
    }
    return undefined;
  }
}

export function asComments(snapshot: CommentRepositorySnapshot): Comments {
  return snapshot as unknown as Comments;
}
