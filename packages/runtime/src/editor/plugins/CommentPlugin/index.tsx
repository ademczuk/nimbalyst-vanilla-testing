/**
 * CommentsPlugin
 *
 * Text-selection comments for collaborative Lexical documents. The floating
 * text toolbar contributes an "Add comment" action; selecting it opens the
 * comments panel with an `@`-mention composer. Comments anchor to the text via
 * `@lexical/mark` `MarkNode`s and persist in the document's shared Y.Doc
 * (top-level `comments` YArray) through the orphaned-upstream `CommentStore`.
 *
 * What is left here is only the Lexical half: mark tracking, selection, mark
 * highlighting, re-anchoring, and the store wiring. Everything that draws a
 * thread, a comment, or the composer is the shared editor-neutral UI in
 * `commenting/ui`, which extension editors mount over their own entities.
 * This file is the Markdown *adapter* for those primitives — it translates
 * MarkNode presence into an anchor state and a selection into a thread.
 *
 * The MarkNode + `INSERT_INLINE_COMMENT_COMMAND` live in `CommentsExtension`.
 */

import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $isMarkNode,
  $unwrapMarkNode,
  $getMarkIDs,
  MarkNode,
} from '@lexical/mark';
import { mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  type NodeKey,
} from 'lexical';

import {
  CommentStore,
  createComment,
  createThread,
  useCommentStore,
  type Comment,
  type CommentActor,
  type Thread,
} from '../../commenting';
import {
  collabCommentControllerRegistry,
  collectMarkIds,
  createCollabCommentController,
} from '../../commenting/CollabCommentControllerRegistry';
import { CommentCollabProvider } from '../../commenting/CommentCollabProvider';
import {
  canAuthorComments,
  resolveCommentCapabilities,
} from '../../commenting/capabilities';
import {
  assertCommentMutationAllowed,
  validateCommentBody,
  validateCommentMentions,
  validateTextQuoteSelector,
} from '../../commenting/commentValidation';
import { reanchorOrphanedThreads } from '../../commenting/reanchorOrphanedThreads';
import type {
  CommentsConfig,
  CommentMentionPayload,
} from '../../commenting/types';
import {
  CollaborativeCommentsPanel,
  CommentCountBadge,
  type CommentThreadView,
} from '../../commenting/ui';
import { INSERT_INLINE_COMMENT_COMMAND } from '../../extensions/builtin/CommentsExtension';
import { OPEN_COMMENT_COMPOSER_COMMAND } from './commands';
import { scrollToCommentAnchor } from './scrollToCommentAnchor';

import './CommentPlugin.css';

type MarkNodeMap = Map<string, Set<NodeKey>>;

/** Coalesce the mark mutations a document rebuild fires before healing. */
const REANCHOR_DEBOUNCE_MS = 250;

const NO_ORPHANS: ReadonlySet<string> = new Set();

export { OPEN_COMMENT_COMPOSER_COMMAND } from './commands';

function createClientMutationId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `comment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

function allowsMountedCommentMutation(config: CommentsConfig): boolean {
  try {
    assertCommentMutationAllowed(
      resolveCommentCapabilities(config),
      config.isHydrated?.() ?? config.getYDoc() !== null,
    );
    return true;
  } catch {
    return false;
  }
}

export default function CommentsPlugin({
  config,
  anchorElem,
}: {
  config: CommentsConfig;
  anchorElem: HTMLElement;
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  // The comments toggle + side panel dock to the right of the editor pane
  // (the `.editor-container`, the anchor's positioned parent) rather than
  // portaling to <body>. This keeps them inside the tab DOM so they hide with
  // the tab when another document/mode is shown, instead of floating globally.
  const paneElem = anchorElem.parentElement ?? anchorElem;
  const commentStore = useMemo(() => new CommentStore(editor), [editor]);
  const comments = useCommentStore(commentStore);
  const markNodeMapRef = useRef<MarkNodeMap>(new Map());
  const controllerInstanceIdRef = useRef(
    `comments-${Math.random().toString(36).slice(2, 12)}`,
  );
  const [markVersion, setMarkVersion] = useState(0);
  // Threads whose quoted text is gone for good: no MarkNode, and the healing
  // pass below could not find the quote either. Derived from a completed pass
  // rather than from "no mark right now", because a document rebuild drops
  // every mark for a beat and every thread would flash as detached.
  const [orphanedThreadIds, setOrphanedThreadIds] =
    useState<ReadonlySet<string>>(NO_ORPHANS);

  const [panelOpen, setPanelOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const threads = useMemo(
    () => comments.filter((c): c is Thread => c.type === 'thread'),
    [comments],
  );

  // -- Attach the CommentStore to the shared document Y.Doc ------------------
  useEffect(() => {
    const doc = config.getYDoc();
    if (!doc) return;
    const provider = new CommentCollabProvider(doc);
    const unregister = commentStore.registerCollaboration(provider);
    return () => {
      unregister();
    };
  }, [commentStore, config]);

  // -- Expose the mounted collaborative comment surface to renderer IPC -----
  useEffect(() => {
    const controller = createCollabCommentController({
      commentStore,
      currentUser: config.currentUser,
      documentTitle: config.documentTitle,
      documentUri: config.documentUri,
      editor,
      getCapabilities: () => resolveCommentCapabilities(config),
      getMembers: config.getMembers,
      isHydrated: () => config.isHydrated?.() ?? config.getYDoc() !== null,
      isVisible: () => {
        const root = editor.getRootElement();
        return Boolean(root?.isConnected && root.getClientRects().length > 0);
      },
      onCommitted: ({
        actor,
        comment,
        mentionedUserIds,
        replyRecipientUserIds,
        thread,
      }) => {
        const actorName =
          actor.kind === 'agent' ? actor.sessionName : actor.displayName;
        const mentionRecipients = mentionedUserIds.filter(
          (id) => id !== config.currentUser.id,
        );
        const payload: CommentMentionPayload = {
          actorName,
          sourceTitle: config.documentTitle,
          snippet: comment.content.slice(0, 200),
          commentId: comment.id,
          threadId: thread.id,
          markId: thread.id,
          url: config.documentUri,
        };
        if (mentionRecipients.length > 0) {
          config.onMention?.(mentionRecipients, payload);
        }
        const replyRecipients = replyRecipientUserIds.filter(
          (id) =>
            id !== config.currentUser.id && !mentionRecipients.includes(id),
        );
        if (replyRecipients.length > 0 && comment.clientMutationId) {
          config.onReply?.(replyRecipients, {
            ...payload,
            commentId: comment.id,
            clientMutationId: comment.clientMutationId,
            replyToCommentId: comment.replyToCommentId,
          });
        }
      },
    });
    return collabCommentControllerRegistry.register(
      config.documentUri,
      controllerInstanceIdRef.current,
      controller,
    );
  }, [commentStore, config, editor]);

  // -- Track MarkNode keys per comment id ------------------------------------
  useEffect(() => {
    const markMap = markNodeMapRef.current;
    return editor.registerMutationListener(
      MarkNode,
      (mutations) => {
        editor.getEditorState().read(() => {
          for (const [key, mutation] of mutations) {
            if (mutation === 'destroyed') {
              for (const [id, keys] of markMap) {
                keys.delete(key);
                if (keys.size === 0) markMap.delete(id);
              }
              continue;
            }
            const node = $getNodeByKey(key);
            if ($isMarkNode(node)) {
              for (const id of node.getIDs()) {
                let keys = markMap.get(id);
                if (!keys) {
                  keys = new Set();
                  markMap.set(id, keys);
                }
                keys.add(key);
              }
            }
          }
        });
        setMarkVersion((v) => v + 1);
      },
      { skipInitialization: false },
    );
  }, [editor]);

  // -- Re-attach orphaned thread anchors -------------------------------------
  // Rebuilding the document from markdown -- the path agent edits take through
  // applyCollabDocEdit -- drops every MarkNode while leaving the threads and
  // the quoted text intact, silently unhighlighting the whole document (#2644).
  // Heal by exact quote match once the doc is hydrated. This runs on every
  // client rather than a single elected writer: a concurrent heal can nest two
  // MarkNodes carrying the same id, which still renders and still unwraps
  // through the mutation-tracked key map.
  useEffect(() => {
    if (threads.length === 0) {
      setOrphanedThreadIds((previous) =>
        previous.size === 0 ? previous : NO_ORPHANS,
      );
      return;
    }
    // A partially-synced document would resolve quotes against incomplete text
    // and anchor them in the wrong place -- permanently, for everyone.
    if (!(config.isHydrated?.() ?? config.getYDoc() !== null)) return;

    const timer = setTimeout(() => {
      // Read-only viewers skip the write but still get an honest answer about
      // which threads no longer point at anything.
      if (canAuthorComments(config)) {
        reanchorOrphanedThreads(editor, threads);
      }
      const attached = collectMarkIds(editor);
      const stillOrphaned = new Set(
        threads
          .filter((thread) => !attached.has(thread.id))
          .map((thread) => thread.id),
      );
      setOrphanedThreadIds((previous) =>
        sameIds(previous, stillOrphaned) ? previous : stillOrphaned,
      );
    }, REANCHOR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [editor, threads, config, markVersion]);

  // -- Track which thread the caret is inside (active mark) ------------------
  useEffect(() => {
    const update = () => {
      editor.getEditorState().read(() => {
        const selection = $getSelection();
        let ids: string[] | null = null;
        if ($isRangeSelection(selection)) {
          const anchorNode = selection.anchor.getNode();
          if ($isTextNode(anchorNode)) {
            ids = $getMarkIDs(anchorNode, selection.anchor.offset);
          }
        }
        if (ids && ids.length > 0) {
          setActiveThreadId(ids[ids.length - 1]);
          setPanelOpen(true);
        }
      });
    };
    return mergeRegister(editor.registerUpdateListener(update));
  }, [editor]);

  // -- Highlight the active thread's mark in the document --------------------
  useEffect(() => {
    const markMap = markNodeMapRef.current;
    for (const [id, keys] of markMap) {
      for (const key of keys) {
        const el = editor.getElementByKey(key);
        if (el) {
          el.classList.toggle('selected', id === activeThreadId);
        }
      }
    }
  }, [editor, activeThreadId, markVersion]);

  // -- Dim the marks of resolved threads in the document ---------------------
  useEffect(() => {
    const markMap = markNodeMapRef.current;
    const resolvedIds = new Set(
      threads.filter((t) => t.resolved).map((t) => t.id),
    );
    for (const [id, keys] of markMap) {
      for (const key of keys) {
        const el = editor.getElementByKey(key);
        if (el) {
          el.classList.toggle('resolved', resolvedIds.has(id));
        }
      }
    }
  }, [editor, threads, markVersion]);

  // -- Helpers ---------------------------------------------------------------
  const removeMark = useCallback(
    (id: string) => {
      editor.update(() => {
        const keys = markNodeMapRef.current.get(id);
        if (!keys) return;
        for (const key of Array.from(keys)) {
          const node = $getNodeByKey(key);
          if ($isMarkNode(node)) {
            node.deleteID(id);
            if (node.getIDs().length === 0) {
              $unwrapMarkNode(node);
            }
          }
        }
      });
    },
    [editor],
  );

  const scrollToThread = useCallback(
    (id: string) => {
      const thread = threads.find((candidate) => candidate.id === id);
      if (!thread) return;
      scrollToCommentAnchor(
        editor,
        markNodeMapRef.current,
        thread.id,
        thread.quote,
      );
    },
    [editor, threads],
  );

  const fanoutMention = useCallback(
    (
      mentionedUserIds: string[],
      snippet: string,
      threadId: string,
      commentId: string,
      actor: CommentActor,
    ) => {
      if (!config.onMention || mentionedUserIds.length === 0) return;
      const recipients = mentionedUserIds.filter(
        (id) => id !== config.currentUser.id,
      );
      if (recipients.length === 0) return;
      const payload: CommentMentionPayload = {
        actorName:
          actor.kind === 'agent' ? actor.sessionName : actor.displayName,
        sourceTitle: config.documentTitle,
        snippet: snippet.slice(0, 200),
        commentId,
        threadId,
        markId: threadId,
        url: config.documentUri,
      };
      config.onMention(recipients, payload);
    },
    [config],
  );

  // -- Actions ---------------------------------------------------------------
  const handleAddComment = useCallback(() => {
    // Re-read rather than trusting the rendered affordance: access can be
    // revoked between the frame that drew the toolbar and this dispatch, and
    // `getCommentToolbarActions` is memoized on the config object's identity,
    // which does not change when the capability behind it flips.
    if (!allowsMountedCommentMutation(config)) return;
    let quote = '';
    let isBackward = false;
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        quote = selection.getTextContent();
        isBackward = selection.isBackward();
      }
    });
    if (!quote.trim()) return;
    try {
      validateTextQuoteSelector({ exact: quote });
    } catch {
      return;
    }

    const thread = createThread(quote, [], undefined, undefined, {
      kind: 'text-quote',
      exact: quote,
    });
    commentStore.addComment(thread);
    editor.dispatchCommand(INSERT_INLINE_COMMENT_COMMAND, {
      id: thread.id,
      isBackward,
    });

    setPanelOpen(true);
    setActiveThreadId(thread.id);
  }, [editor, commentStore, config]);

  useEffect(
    () =>
      editor.registerCommand(
        OPEN_COMMENT_COMPOSER_COMMAND,
        () => {
          handleAddComment();
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, handleAddComment],
  );

  const handleReply = useCallback(
    (thread: Thread, text: string, mentionedUserIds: string[]) => {
      if (!allowsMountedCommentMutation(config)) return;
      let body: string;
      let mentions: string[];
      try {
        body = validateCommentBody(text);
        mentions = validateCommentMentions(
          mentionedUserIds,
          config.getMembers(),
        );
      } catch {
        return;
      }
      const actor: CommentActor = {
        kind: 'user',
        userId: config.currentUser.id,
        displayName: config.currentUser.name,
      };
      const replyTarget = thread.comments.at(-1);
      const clientMutationId = createClientMutationId();
      const comment = createComment(body, config.currentUser.name, {
        actor,
        clientMutationId,
        replyToCommentId: replyTarget?.id,
      });
      commentStore.addComment(comment, thread);
      fanoutMention(mentions, body, thread.id, comment.id, actor);
      const replyRecipient =
        replyTarget?.actor?.kind === 'user'
          ? replyTarget.actor.userId
          : undefined;
      if (
        replyRecipient &&
        replyRecipient !== config.currentUser.id &&
        !mentions.includes(replyRecipient)
      ) {
        config.onReply?.([replyRecipient], {
          actorName: config.currentUser.name,
          sourceTitle: config.documentTitle,
          snippet: body.slice(0, 200),
          threadId: thread.id,
          markId: thread.id,
          url: config.documentUri,
          commentId: comment.id,
          clientMutationId,
          replyToCommentId: replyTarget?.id,
        });
      }
      setActiveThreadId(thread.id);
    },
    [commentStore, config, fanoutMention],
  );

  const handleSetThreadResolved = useCallback(
    (thread: Thread, resolved: boolean) => {
      if (!allowsMountedCommentMutation(config)) return;
      // Resolving is a non-destructive state change: the thread, its comments,
      // and the document MarkNode are all kept (the mark just renders dimmed).
      commentStore.setThreadResolved(thread, resolved);
      if (resolved && activeThreadId === thread.id) {
        setActiveThreadId(null);
      }
    },
    [commentStore, activeThreadId, config],
  );

  const handleDeleteThread = useCallback(
    (thread: Thread) => {
      if (!allowsMountedCommentMutation(config)) return;
      // Destructive: removes the thread entirely and unwraps its mark.
      commentStore.deleteCommentOrThread(thread);
      removeMark(thread.id);
      if (activeThreadId === thread.id) {
        setActiveThreadId(null);
      }
    },
    [commentStore, removeMark, activeThreadId, config],
  );

  const handleDeleteComment = useCallback(
    (comment: Comment, thread: Thread) => {
      if (!allowsMountedCommentMutation(config)) return;
      commentStore.deleteCommentOrThread(comment, thread);
      // If that was the last comment, also resolve (remove) the thread + mark.
      if (thread.comments.length <= 1) {
        commentStore.deleteCommentOrThread(thread);
        removeMark(thread.id);
      }
    },
    [commentStore, removeMark, config],
  );

  const handleSelectThread = useCallback(
    (id: string) => {
      setActiveThreadId(id);
      scrollToThread(id);
    },
    [scrollToThread],
  );

  const openAgentSession = useCallback((sessionId: string) => {
    window.dispatchEvent(
      new CustomEvent('open-ai-session', { detail: { sessionId } }),
    );
  }, []);

  const getMembers = useCallback(() => config.getMembers(), [config]);

  // A MarkNode is Markdown's anchor, so "the mark is gone and the quote could
  // not be found again" is what orphaned means here. The thread and its
  // history stay in the panel either way.
  const threadViews = useMemo<CommentThreadView[]>(
    () =>
      threads.map((thread) => ({
        thread,
        anchorState: orphanedThreadIds.has(thread.id) ? 'orphaned' : 'attached',
      })),
    [threads, orphanedThreadIds],
  );

  // Read on every render and deliberately not memoized on `config`: hosts keep
  // the same config object across an access change, so a memo keyed on its
  // identity would leave the gate showing stale affordances after revocation.
  const capabilities = resolveCommentCapabilities(config);

  // Reserve room on the right of the editor pane while the panel is docked
  // open, so document text isn't hidden underneath it.
  useEffect(() => {
    paneElem.classList.toggle('comments-panel-open', panelOpen);
    return () => {
      paneElem.classList.remove('comments-panel-open');
    };
  }, [paneElem, panelOpen]);

  return (
    <>
      {/* Toggle + panel dock into the editor pane (not <body>) so they stay
          scoped to this tab. */}
      {!panelOpen &&
        createPortal(
          <button
            type="button"
            className="nim-comments-toggle"
            data-testid="comments-toggle"
            title="Comments"
            aria-label="Toggle comments"
            onClick={() => setPanelOpen(true)}
          >
            <span aria-hidden="true" className="material-symbols-outlined">
              chat_bubble
            </span>
            <CommentCountBadge
              count={threads.length}
              className="nim-comments-toggle-count"
            />
          </button>,
          paneElem,
        )}

      {panelOpen &&
        createPortal(
          <CollaborativeCommentsPanel
            className="nim-comments-panel--docked"
            threads={threadViews}
            activeThreadId={activeThreadId}
            autoFocusThreadId={activeThreadId}
            capabilities={capabilities}
            getMembers={getMembers}
            onSelectThread={handleSelectThread}
            onSetThreadResolved={handleSetThreadResolved}
            onDeleteThread={handleDeleteThread}
            onDeleteComment={handleDeleteComment}
            onReply={handleReply}
            onOpenAgentSession={openAgentSession}
            onClose={() => setPanelOpen(false)}
          />,
          paneElem,
        )}
    </>
  );
}
