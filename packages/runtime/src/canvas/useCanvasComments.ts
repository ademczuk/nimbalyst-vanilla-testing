/**
 * All of the board's comment wiring in one place: the thread projection, the
 * anchor adapter the platform resolves through, the dual counts, and the
 * `@agent` dispatch.
 *
 * What this deliberately does NOT do is render a thread, a reply box, or a
 * resolve button. Those belong to the host's comments panel
 * (`CollaborativeCommentsPanel`, docked by `CollabCommentsPanelDock`), which
 * every collaborative extension tab already gets, and which owns grouping,
 * detached threads, mentions, keyboard navigation, deletion, and the
 * agent-session link. The canvas owns exactly two things the panel cannot know:
 * where a thread sits on the board, and how to bring it into view.
 *
 * The host `comments` service is optional and its absence is not an error. A
 * board opened outside a collaborative room -- a private `.canvas` file, which
 * is the common case -- has no comment room, so it has no comments. It must not
 * fall back to a local simulation: a comment that looked shared and was not is
 * worse than a missing button.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type {
  CollaborationCommentsService,
  CommentMember,
  MountedCommentAnchorAdapter,
} from '@nimbalyst/extension-sdk';

import type { CanvasDocument } from './CanvasDocument';
import {
  canvasAgentDispatchPrompt,
  canvasCardCommentCounts,
  canvasPendingAgentRequests,
  projectCanvasCommentThreads,
  withCanvasCardDocumentCounts,
  type CanvasAgentThreadRequest,
  type CanvasCardCommentCounts,
  type CanvasCommentTarget,
  type CanvasCommentThreadView,
} from './canvasComments';
import {
  canvasCommentAnchorState,
  canvasNodeCommentAnchor,
  canvasNodeIdFromAnchor,
  canvasPointCommentAnchor,
  canvasPointFromAnchor,
  describeCanvasCommentAnchor,
  isCanvasCommentAnchor,
} from './canvasCommentAnchors';
import { getCanvasCallbacks, type CanvasCardReference } from './canvasCallbacks';
import { canvasCardLabel, canvasCardReference } from './canvasFlowMapping';

const EMPTY_THREADS: readonly CanvasCommentThreadView[] = Object.freeze([]);
const EMPTY_COUNTS: ReadonlyMap<string, CanvasCardCommentCounts> = new Map();
const EMPTY_MEMBERS: CommentMember[] = [];
const EMPTY_AGENT_REQUESTS: readonly CanvasAgentThreadRequest[] = Object.freeze(
  []
);

/** What the surface needs; everything else stays in this module. */
export interface CanvasCommentsModel {
  /** False when this board has no comment room at all. */
  enabled: boolean;
  canComment: boolean;
  threads: readonly CanvasCommentThreadView[];
  counts: ReadonlyMap<string, CanvasCardCommentCounts>;
  getMembers(): CommentMember[];
  createThread(
    target: CanvasCommentTarget,
    body: string,
    mentionedUserIds: string[]
  ): Promise<void>;
  /** Reveal a thread in the host's panel. */
  openThread(threadId: string): void;
  /** The surface publishes how to bring a target into view. */
  registerFocus(
    handler: ((target: CanvasCommentTarget) => boolean) | null
  ): void;
  /**
   * `@agent` asks waiting on this user to say yes.
   *
   * Never dispatched on arrival. The document cannot prove who wrote a comment,
   * and the session would run here -- see `canvasPendingAgentRequests`. Empty on
   * a host with no `dispatchAgentThread`, so a mention stays an ordinary comment
   * rather than a button that does nothing.
   */
  agentRequests: readonly CanvasAgentThreadRequest[];
  /** Start a session for this ask. Only ever called from a user gesture. */
  confirmAgentRequest(commentId: string): void;
  /** Drop the ask without starting anything. */
  dismissAgentRequest(commentId: string): void;
}

export const DISABLED_CANVAS_COMMENTS: CanvasCommentsModel = {
  enabled: false,
  canComment: false,
  threads: EMPTY_THREADS,
  counts: EMPTY_COUNTS,
  getMembers: () => EMPTY_MEMBERS,
  createThread: async () => {},
  openThread: () => {},
  registerFocus: () => {},
  agentRequests: EMPTY_AGENT_REQUESTS,
  confirmAgentRequest: () => {},
  dismissAgentRequest: () => {},
};

export interface UseCanvasCommentsOptions {
  /** Null outside a collaborative room, or where the host offers no service. */
  service: CollaborationCommentsService | null | undefined;
  /** The live board, for anchor resolution and card labels. */
  document: CanvasDocument;
  /** The signed-in collaborator; `@agent` dispatch needs their id. */
  user: { id: string; name: string } | null | undefined;
  /** Board name for the dispatch prompt. */
  boardName: string;
  /** The `collab://` URI of this board, when it has one. */
  documentUri?: string | null;
}

export function useCanvasComments({
  service,
  document,
  user,
  boardName,
  documentUri,
}: UseCanvasCommentsOptions): CanvasCommentsModel {
  // Read through a ref inside the adapter closures: the adapter is registered
  // once for the life of the service, but it has to answer against whatever the
  // board looks like *now*, not what it looked like when it was built.
  const documentRef = useRef(document);
  documentRef.current = document;

  const focusRef = useRef<((target: CanvasCommentTarget) => boolean) | null>(
    null
  );
  const registerFocus = useCallback(
    (handler: ((target: CanvasCommentTarget) => boolean) | null) => {
      focusRef.current = handler;
    },
    []
  );

  const findNode = useCallback((nodeId: string) => {
    return (documentRef.current.nodes ?? []).find(
      (candidate) => candidate.id === nodeId
    );
  }, []);
  const hasNode = useCallback(
    (nodeId: string) => findNode(nodeId) !== undefined,
    [findNode]
  );
  const nodeLabel = useCallback(
    (nodeId: string): string | null => {
      const node = findNode(nodeId);
      return node === undefined ? null : canvasCardLabel(node);
    },
    [findNode]
  );

  // The platform refuses to create a thread whose anchor no mounted adapter
  // reports `attached`, and takes the thread's stored quote from `describe`.
  // Both are this, so a card comment and its panel label cannot disagree.
  const adapter = useMemo<MountedCommentAnchorAdapter>(
    () => ({
      handles: (anchor) => isCanvasCommentAnchor(anchor),
      getState: (anchor) => canvasCommentAnchorState(anchor, hasNode),
      describe: (anchor) => {
        const nodeId = canvasNodeIdFromAnchor(anchor);
        return describeCanvasCommentAnchor(
          anchor,
          nodeId === null ? null : nodeLabel(nodeId)
        );
      },
      focus: (anchor) => {
        const target = canvasCommentTargetFromAnchor(anchor);
        // An orphaned card cannot be brought into view, and saying so is what
        // makes the panel print "there is nothing to jump to" instead of a
        // silent no-op. The thread and its history stay exactly where they are.
        if (!target) return false;
        if (target.kind === 'node' && !hasNode(target.nodeId)) return false;
        return focusRef.current?.(target) ?? false;
      },
    }),
    [hasNode, nodeLabel]
  );

  useEffect(() => {
    if (!service) return;
    return service.registerAnchorAdapter(adapter);
  }, [service, adapter]);

  const snapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => service?.subscribe(listener) ?? (() => {}),
      [service]
    ),
    useCallback(() => service?.getSnapshot(), [service])
  );

  const capabilities = service?.getCapabilities();
  const canComment = capabilities?.comment === true;

  const threads = useMemo(
    () =>
      snapshot === undefined
        ? EMPTY_THREADS
        : projectCanvasCommentThreads(snapshot, hasNode),
    // `document` is a real dependency even though it is read through a ref:
    // deleting a card must re-evaluate every thread's orphan state.
    [snapshot, hasNode, document]
  );

  const counts = useCanvasCardDocumentCounts(document, threads);

  const getMembers = useCallback(
    () => service?.getMentionableMembers() ?? EMPTY_MEMBERS,
    [service]
  );

  const createThread = useCallback(
    async (
      target: CanvasCommentTarget,
      body: string,
      mentionedUserIds: string[]
    ) => {
      const content = body.trim();
      if (!service || !content) return;
      const anchor =
        target.kind === 'node'
          ? canvasNodeCommentAnchor(
              target.nodeId,
              nodeLabel(target.nodeId) ?? undefined
            )
          : canvasPointCommentAnchor(target.point);
      await service.createThread({
        anchor,
        content,
        clientMutationId: newCanvasCommentMutationId(),
        ...(mentionedUserIds.length > 0 ? { mentionedUserIds } : {}),
      });
    },
    [service, nodeLabel]
  );

  const openThread = useCallback(
    (threadId: string) => {
      service?.openPanel?.({ threadId });
    },
    [service]
  );

  const agent = useCanvasAgentRequests({
    snapshot,
    hasNode,
    nodeLabel,
    user,
    boardName,
    documentUri,
  });

  // Memoized because the surface registers effects keyed on this object: a
  // fresh identity every render would tear down and rebuild the focus
  // registration on every pointer move that publishes awareness.
  return useMemo(
    () => ({
      enabled: service !== null && service !== undefined,
      canComment,
      threads,
      counts,
      getMembers,
      createThread,
      openThread,
      registerFocus,
      agentRequests: agent.pending,
      confirmAgentRequest: agent.confirm,
      dismissAgentRequest: agent.dismiss,
    }),
    [
      service,
      canComment,
      threads,
      counts,
      getMembers,
      createThread,
      openThread,
      registerFocus,
      agent,
    ]
  );
}

/**
 * Merge the host's in-document counts into the canvas-side counts.
 *
 * Two subscriptions rather than one derivation: the canvas numbers change when
 * a thread on the board changes, the document numbers change when a card's own
 * room does, and folding them into one memo would recompute both every time
 * either moved.
 */
function useCanvasCardDocumentCounts(
  document: CanvasDocument,
  threads: readonly CanvasCommentThreadView[]
): ReadonlyMap<string, CanvasCardCommentCounts> {
  const references = useMemo(() => {
    const entries: Array<{ nodeId: string; reference: CanvasCardReference }> =
      [];
    for (const node of document.nodes ?? []) {
      const reference = canvasCardReference(node);
      if (reference) entries.push({ nodeId: node.id, reference });
    }
    return entries;
  }, [document]);

  // Value identity, so a card moving does not resubscribe every card's room.
  const referenceKey = useMemo(
    () => JSON.stringify(references.map((entry) => entry.reference)),
    [references]
  );

  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const source = getCanvasCallbacks().cardComments;
    if (!source) return;
    const watched = references.map((entry) => entry.reference);
    return source.watch(watched, () => setEpoch((value) => value + 1));
    // `references` is intentionally not a dependency: it changes identity on
    // every card move, while `referenceKey` changes only when the set does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceKey]);

  return useMemo(() => {
    const canvasCounts = canvasCardCommentCounts(threads);
    const source = getCanvasCallbacks().cardComments;
    if (!source || references.length === 0) return canvasCounts;
    const byNode = new Map(
      references.map((entry) => [entry.nodeId, entry.reference])
    );
    return withCanvasCardDocumentCounts(
      canvasCounts,
      [...byNode.keys()],
      (nodeId) => {
        const reference = byNode.get(nodeId);
        return reference ? source.getOpenThreadCount(reference) : null;
      }
    );
  }, [threads, references, epoch]);
}

/**
 * Surface this user's `@agent` asks and start a session only when they say so.
 *
 * There is deliberately no effect here that calls the host. An earlier shape of
 * this hook dispatched the moment a matching comment appeared in the snapshot,
 * which made `comment.actor.userId` -- ordinary shared-document data anyone in
 * the room can write -- the only thing standing between a teammate and a prompt
 * of their choosing running in this user's workspace. Consent is the boundary
 * that actually holds: the session runs on this machine, so the person at this
 * machine is the one who can authorize it, whatever the document claims.
 *
 * The settled set is per mount and lives in state, because the pending list is
 * rendered. A remount (closing and reopening the board) re-offers an ask that is
 * still unresolved, which is a deliberate trade -- the alternative is persisting
 * bookkeeping into the shared document, where it would be board content, would
 * sync to everyone, and would be writable by the same people the gate exists
 * for.
 */
function useCanvasAgentRequests(input: {
  snapshot: ReturnType<CollaborationCommentsService['getSnapshot']> | undefined;
  hasNode: (nodeId: string) => boolean;
  nodeLabel: (nodeId: string) => string | null;
  user: { id: string; name: string } | null | undefined;
  boardName: string;
  documentUri?: string | null;
}): {
  pending: readonly CanvasAgentThreadRequest[];
  confirm: (commentId: string) => void;
  dismiss: (commentId: string) => void;
} {
  const { snapshot, hasNode, nodeLabel, user, boardName, documentUri } = input;
  const [settled, setSettled] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  const pending = useMemo(() => {
    if (!snapshot || !user?.id || !documentUri) return EMPTY_AGENT_REQUESTS;
    // A host with no session runner has nothing to confirm *into*, so the
    // mention stays an ordinary comment instead of offering a button that
    // cannot do anything. The browser console is that host today.
    if (!getCanvasCallbacks().dispatchAgentThread) return EMPTY_AGENT_REQUESTS;
    const requests = canvasPendingAgentRequests(snapshot, {
      viewerUserId: user.id,
      settled,
      hasNode,
      getNodeLabel: nodeLabel,
    });
    return requests.length === 0 ? EMPTY_AGENT_REQUESTS : requests;
  }, [snapshot, settled, hasNode, nodeLabel, user?.id, documentUri]);

  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const settle = useCallback((commentId: string) => {
    setSettled((current) => {
      if (current.has(commentId)) return current;
      const next = new Set(current);
      next.add(commentId);
      return next;
    });
  }, []);

  const confirm = useCallback(
    (commentId: string) => {
      const request = pendingRef.current.find(
        (candidate) => candidate.commentId === commentId
      );
      const dispatch = getCanvasCallbacks().dispatchAgentThread;
      if (!request || !dispatch || !documentUri) return;
      // Settled before the call: a host that throws must not leave the ask
      // eligible to be started twice by an impatient second click.
      settle(commentId);
      try {
        dispatch({
          threadId: request.threadId,
          commentId: request.commentId,
          anchorLabel: request.anchorLabel,
          prompt: canvasAgentDispatchPrompt(request, {
            documentUri,
            boardName,
            confirmedByName: user?.name ?? 'the signed-in user',
          }),
        });
      } catch (error) {
        console.error('[Canvas] could not dispatch an @agent thread', error);
      }
    },
    [boardName, documentUri, settle, user?.name]
  );

  return useMemo(
    () => ({ pending, confirm, dismiss: settle }),
    [pending, confirm, settle]
  );
}

/** The anchor as something the surface can move the viewport to. */
function canvasCommentTargetFromAnchor(
  anchor: Parameters<MountedCommentAnchorAdapter['focus']>[0]
): CanvasCommentTarget | null {
  const nodeId = canvasNodeIdFromAnchor(anchor);
  if (nodeId !== null) return { kind: 'node', nodeId };
  const point = canvasPointFromAnchor(anchor);
  return point ? { kind: 'point', point } : null;
}

function newCanvasCommentMutationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `canvas-comment-${Math.random().toString(36).slice(2, 10)}`;
}
