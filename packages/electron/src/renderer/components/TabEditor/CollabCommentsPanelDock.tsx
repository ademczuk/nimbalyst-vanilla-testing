/**
 * The host-owned comments surface for a collaborative extension editor tab.
 *
 * The platform owns this pane: the thread list, the composer, the mention
 * picker, the resolved filter, the detached group, and the keyboard surface all
 * come from the shared primitives in `runtime/editor/commenting/ui`. An
 * extension owns only its own markers and what "focus this anchor" means to its
 * canvas, which it supplies through a `MountedCommentAnchorAdapter`.
 *
 * Two things here are load-bearing rather than decorative:
 *
 * - **A thread whose anchor is gone stays visible with its whole history.** The
 *   panel groups it under Detached; this dock additionally says, once, why the
 *   jump the user asked for did not happen. Never hidden, never deleted.
 * - **Reads and writes go through the same tab-scoped host objects the agent
 *   controller uses.** The panel does not keep a second copy of the threads,
 *   so what a reader sees and what `documentComments` lists cannot diverge.
 */

import type { JSX } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CollaborativeCommentsPanel } from '@nimbalyst/runtime/editor/commenting/ui/CollaborativeCommentsPanel';
import { useCollaborativeComments } from '@nimbalyst/runtime/editor/commenting/ui/useCollaborativeComments';

import { errorNotificationService } from '../../services/ErrorNotificationService';
import {
  subscribeCommentPanelRequests,
  type CommentPanelRequest,
} from './collabCommentPanelRequests';
import type {
  HostedCollaborationComments,
  HostedCommentsPanelSource,
} from './collaborationCommentsService';

export interface CollabCommentsPanelState {
  isOpen: boolean;
  activeThreadId: string | null;
  /** Why the requested jump did not happen, or null. */
  focusNotice: string | null;
  selectThread(threadId: string): void;
  close(): void;
}

const NO_TARGET_NOTICE =
  'That comment is no longer in this document. It may have been deleted.';
const ORPHANED_NOTICE =
  'What this comment pointed at is no longer in the document, so there is nothing to jump to. The conversation is kept.';
const UNSUPPORTED_NOTICE =
  'This comment points at something this editor does not understand, so it cannot be shown in place. The conversation is kept.';
const UNAVAILABLE_NOTICE =
  'This editor could not bring that comment into view.';

/**
 * Why focus failed, read from the same source the panel renders from — so the
 * explanation and the thread card's own Detached notice cannot contradict
 * each other.
 */
function explainFocusFailure(
  source: HostedCommentsPanelSource,
  threadId: string,
): string {
  const thread = source.getThreads().find((entry) => entry.id === threadId);
  if (!thread) return NO_TARGET_NOTICE;
  switch (source.getAnchorState?.(thread)) {
    case 'orphaned':
      return ORPHANED_NOTICE;
    case 'unsupported':
      return UNSUPPORTED_NOTICE;
    default:
      return UNAVAILABLE_NOTICE;
  }
}

/**
 * Panel visibility and selection for one collaborative tab.
 *
 * Requests arrive from `collabCommentPanelRequests` rather than as a callback
 * prop because the two callers — an extension through the SDK, and a comment
 * notification deep link — neither of which can hold a reference to this
 * component, and the deep link fires before the tab exists.
 */
export function useCollabCommentsPanel(input: {
  documentUri: string;
  panelSource: HostedCommentsPanelSource | null;
}): CollabCommentsPanelState {
  const { documentUri, panelSource } = input;
  const [isOpen, setIsOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  // Focus is async. A second request while the first is in flight owns the
  // panel; the stale result must not overwrite its notice.
  const requestGeneration = useRef(0);

  useEffect(() => {
    if (!panelSource) return;
    let disposed = false;

    const apply = (request: CommentPanelRequest): void => {
      const generation = ++requestGeneration.current;
      setIsOpen(true);
      setFocusNotice(null);
      if (!request.threadId) return;
      const threadId = request.threadId;
      setActiveThreadId(threadId);
      void panelSource
        .focusThread(threadId)
        .then((focused) => {
          if (disposed || requestGeneration.current !== generation) return;
          // The thread stays selected and readable either way; only the
          // in-place jump is what may be unavailable.
          if (!focused) {
            setFocusNotice(explainFocusFailure(panelSource, threadId));
          }
        })
        .catch(() => {
          if (disposed || requestGeneration.current !== generation) return;
          setFocusNotice(UNAVAILABLE_NOTICE);
        });
    };

    const unsubscribe = subscribeCommentPanelRequests(documentUri, apply);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [documentUri, panelSource]);

  const selectThread = useCallback(
    (threadId: string) => {
      requestGeneration.current += 1;
      setActiveThreadId(threadId);
      setFocusNotice(null);
      setIsOpen(true);
      void panelSource?.focusThread(threadId).catch(() => undefined);
    },
    [panelSource],
  );

  const close = useCallback(() => {
    requestGeneration.current += 1;
    setIsOpen(false);
    setActiveThreadId(null);
    setFocusNotice(null);
  }, []);

  return { isOpen, activeThreadId, focusNotice, selectThread, close };
}

export interface CollabCommentsPanelDockProps {
  hosted: HostedCollaborationComments;
  panel: CollabCommentsPanelState;
}

function newCommentMutationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `collab-comment-${Math.random().toString(36).slice(2, 10)}`;
}

function reportRefusal(action: string, error: unknown): void {
  // A refused write must not vanish. The panel has no error surface of its
  // own, so it goes to the app's notification lane rather than a console line
  // nobody reads.
  errorNotificationService.showError(
    `Could not ${action} this comment`,
    error instanceof Error ? error.message : String(error),
  );
}

export function CollabCommentsPanelDock({
  hosted,
  panel,
}: CollabCommentsPanelDockProps): JSX.Element | null {
  const { panelSource, service } = hosted;
  const view = useCollaborativeComments(panelSource);

  const getMembers = useCallback(
    () => service.getMentionableMembers(),
    [service],
  );

  if (!panel.isOpen) return null;

  return (
    <aside
      className="collab-comments-dock flex w-80 shrink-0 flex-col overflow-hidden border-l border-nim bg-nim"
      aria-label="Document comments"
    >
      {panel.focusNotice && (
        <div
          className="collab-comments-dock-notice px-3 py-2 text-xs text-nim-muted border-b border-nim"
          data-testid="collab-comments-focus-notice"
          role="status"
        >
          {panel.focusNotice}
        </div>
      )}
      <CollaborativeCommentsPanel
        className="collab-comments-dock-panel"
        threads={view.threads}
        activeThreadId={panel.activeThreadId}
        capabilities={view.capabilities}
        getMembers={getMembers}
        emptyMessage={
          view.canComment
            ? 'No comments yet. Add one from the editor to start a thread.'
            : 'No comments yet.'
        }
        onClose={panel.close}
        onSelectThread={panel.selectThread}
        onSetThreadResolved={(thread, resolved) => {
          void service
            .setResolved(thread.id, resolved)
            .catch((error) => reportRefusal('resolve', error));
        }}
        onReply={(thread, text, mentionedUserIds) => {
          void service
            .reply({
              threadId: thread.id,
              content: text,
              clientMutationId: newCommentMutationId(),
              mentionedUserIds,
            })
            .catch((error) => reportRefusal('reply to', error));
        }}
        onDeleteThread={(thread) => {
          void panelSource
            .deleteThread(thread.id)
            .catch((error) => reportRefusal('delete', error));
        }}
        onDeleteComment={(comment, thread) => {
          void panelSource
            .deleteComment(thread.id, comment.id)
            .catch((error) => reportRefusal('delete', error));
        }}
        onOpenAgentSession={(sessionId) => {
          window.dispatchEvent(
            new CustomEvent('open-ai-session', { detail: { sessionId } }),
          );
        }}
      />
    </aside>
  );
}
