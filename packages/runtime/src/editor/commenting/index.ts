/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { LexicalEditor } from 'lexical';

import { TOGGLE_CONNECT_COMMAND, type Provider } from '@lexical/yjs';
import { COMMAND_PRIORITY_LOW } from 'lexical';
import { useSyncExternalStore } from 'react';
import { Doc, type Array as YArray, type Map as YMap } from 'yjs';

import {
  asComments,
  createComment,
  createCommentSharedMap,
  createThread,
  normalizeCommentActor,
  YDocCommentRepository,
} from './YDocCommentRepository';
import type { Comment, Comments, Thread } from './types';

export type {
  AgentCommentActor,
  Comment,
  CommentActor,
  CommentAnchor,
  Comments,
  EntityCommentAnchor,
  TextQuoteCommentAnchor,
  Thread,
  UserCommentActor,
} from './types';
export {
  CommentRepositoryMutationError,
  createComment,
  createCommentSharedMap,
  createThread,
  getCommentAnchorSupport,
  materializeSharedComment,
  normalizeCommentActor,
  YDocCommentRepository,
} from './YDocCommentRepository';
export {
  COMMENT_BOUNDS,
  normalizeCommentPage,
  normalizeVisibleCommentText,
  truncateCommentUtf8,
  utf8ByteLength,
  validateCommentBody,
  validateCommentMentions,
  validateCommentMutationId,
  validateTextQuoteSelector,
} from './commentValidation';
export type {
  CommentAnchorSupport,
  CommentRepositorySnapshot,
  CommentSnapshot,
  CreateCommentOptions,
  RepositoryMutationResult,
  ThreadSnapshot,
} from './YDocCommentRepository';
// Editor-neutral comment UI. Importing it here also loads the shared
// stylesheet, so a host that pulls the barrel gets a styled panel.
export * from './ui';

type CommentRepositoryProvider = Provider & {
  commentRepository?: YDocCommentRepository;
  doc?: Doc;
};

/**
 * Lexical compatibility adapter over the runtime-neutral Y.Doc repository.
 * It retains the upstream API and connection command, but owns no materialized
 * comment graph of its own.
 */
export class CommentStore {
  _editor: LexicalEditor;
  _changeListeners: Set<() => void>;
  _collabProvider: null | Provider;
  private repository: YDocCommentRepository;
  private unsubscribeRepository: () => void;

  constructor(editor: LexicalEditor) {
    this._editor = editor;
    this._collabProvider = null;
    this._changeListeners = new Set();
    this.repository = new YDocCommentRepository(new Doc());
    this.unsubscribeRepository = this.repository.subscribe(
      this.triggerOnChange,
    );
  }

  isCollaborative(): boolean {
    return this._collabProvider !== null;
  }

  getComments(): Comments {
    return asComments(this.repository.getSnapshot());
  }

  getRepository(): YDocCommentRepository {
    return this.repository;
  }

  addComment(
    commentOrThread: Comment | Thread,
    thread?: Thread,
    offset?: number,
  ): void {
    if (thread !== undefined && commentOrThread.type === 'comment') {
      this.repository.appendReply(thread.id, commentOrThread, offset);
    } else if (commentOrThread.type === 'thread') {
      this.repository.addThread(commentOrThread, offset);
    } else {
      this.repository.addTopLevelComment(commentOrThread, offset);
    }
  }

  deleteCommentOrThread(
    commentOrThread: Comment | Thread,
    thread?: Thread,
  ): { markedComment: Comment; index: number } | null {
    if (commentOrThread.type === 'comment' && thread !== undefined) {
      return this.repository.deleteComment(thread.id, commentOrThread.id);
    }
    if (commentOrThread.type === 'comment') {
      return this.repository.deleteTopLevelComment(commentOrThread.id);
    }
    if (commentOrThread.type === 'thread') {
      this.repository.deleteThread(commentOrThread.id);
    }
    return null;
  }

  setThreadResolved(thread: Thread, resolved: boolean): void {
    this.repository.setThreadResolved(thread.id, resolved);
  }

  registerOnChange(onChange: () => void): () => void {
    this._changeListeners.add(onChange);
    return () => this._changeListeners.delete(onChange);
  }

  // Kept for compatibility with focused storage tests and older headless code.
  _getCollabComments(): null | YArray<YMap<unknown>> {
    if (!this.isCollaborative()) return null;
    return (
      (this._collabProvider as CommentRepositoryProvider).doc?.getArray<
        YMap<unknown>
      >('comments') ?? null
    );
  }

  _createCollabSharedMap(commentOrThread: Comment | Thread): YMap<unknown> {
    return createCommentSharedMap(commentOrThread);
  }

  registerCollaboration(provider: Provider): () => void {
    this._collabProvider = provider;
    const commentProvider = provider as CommentRepositoryProvider;
    const doc = commentProvider.doc;
    if (!doc) {
      throw new Error('The comment collaboration provider has no Y.Doc.');
    }
    this.replaceRepository(
      commentProvider.commentRepository ?? new YDocCommentRepository(doc),
    );

    const connect = () => provider.connect();
    const disconnect = () => {
      try {
        provider.disconnect();
      } catch {
        // The document connection is owned by the host.
      }
    };

    const unsubscribeCommand = this._editor.registerCommand(
      TOGGLE_CONNECT_COMMAND,
      (shouldConnect) => {
        if (shouldConnect) {
          // eslint-disable-next-line no-console
          console.log('Comments connected!');
          connect();
        } else {
          // eslint-disable-next-line no-console
          console.log('Comments disconnected!');
          disconnect();
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    connect();
    return () => {
      unsubscribeCommand();
      this.unsubscribeRepository();
      this.repository.destroy();
      this._collabProvider = null;
    };
  }

  private readonly triggerOnChange = (): void => {
    for (const listener of this._changeListeners) listener();
  };

  private replaceRepository(repository: YDocCommentRepository): void {
    const pending = this.repository.getSnapshot();
    this.unsubscribeRepository();
    this.repository.destroy();
    this.repository = repository;
    const existingIds = new Set(
      repository.getSnapshot().map((comment) => comment.id),
    );
    for (const commentOrThread of pending) {
      if (existingIds.has(commentOrThread.id)) continue;
      if (commentOrThread.type === 'thread') {
        repository.addThread(commentOrThread as unknown as Thread);
      } else {
        repository.addTopLevelComment(commentOrThread as unknown as Comment);
      }
      existingIds.add(commentOrThread.id);
    }
    this.unsubscribeRepository = repository.subscribe(this.triggerOnChange);
    this.triggerOnChange();
  }
}

export function useCommentStore(commentStore: CommentStore): Comments {
  return useSyncExternalStore(
    (listener) => commentStore.registerOnChange(listener),
    () => commentStore.getComments(),
    () => commentStore.getComments(),
  );
}
