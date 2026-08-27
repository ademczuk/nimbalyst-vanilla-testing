/**
 * `@agent` on a canvas comment thread, turned into a working session.
 *
 * **This is only ever reached from a click.** The runtime routes an `@agent`
 * mention to one client and composes the prompt, but it does not decide to start
 * anything -- a comment's claimed author is shared-document data any member of
 * the room can write, so the person at this keyboard confirms before a session
 * runs here with their permissions. See `canvasPendingAgentRequests`. Anything
 * added to this module inherits that: it may assume a human said yes, and it may
 * not assume anything in `request` is trustworthy text.
 *
 * This is the desktop's answer to "start a session and give it this prompt," and
 * it is deliberately the same answer the smart-commit flow already gives:
 * `createNewSessionActionAtom` to create and register the session, then
 * `ai:sendMessage`, with the genuine-CLI provider routed through the prompt
 * queue instead because it has no in-process SDK loop to send into.
 *
 * The session is created but **not** selected. The user asked for work from
 * inside a board they are reading; yanking their view to a transcript is not
 * what they asked for, and the answer is coming back to the thread they are
 * already looking at. A notification says the session started, so the request
 * is not silent while the agent works.
 *
 * What this does not do is write the reply. That is the session's own job,
 * through `replyToCollabDocComment`, which already stamps the agent identity --
 * `sessionId`, `sessionName`, `onBehalfOfUserId` -- onto the comment. A second
 * path for an agent to write a comment would be a second identity model.
 */

import { store } from '@nimbalyst/runtime/store';
import type { CanvasAgentDispatch } from '@nimbalyst/runtime/canvas';

import { createNewSessionActionAtom } from '../../store/actions/sessionHistoryActions';
import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';
import { errorNotificationService } from '../../services/ErrorNotificationService';
import { isClaudeCliTerminalSession } from '../UnifiedAI/claudeCliInputRouting';

const MAX_SESSION_TITLE = 80;

export async function dispatchCanvasAgentThread(
  request: CanvasAgentDispatch,
): Promise<void> {
  const workspacePath = store.get(activeWorkspacePathAtom);
  if (!workspacePath || !window.electronAPI) return;

  // The anchor label is a card label out of the shared board, so it is somebody
  // else's writing arriving in a session title. Line breaks and control
  // characters come out: a title is one line in a list, and a name that can span
  // several of them can push the rest of the list around.
  const anchor =
    request.anchorLabel.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim() || 'board';
  const title = `Canvas comment: ${anchor}`.slice(0, MAX_SESSION_TITLE);

  const sessionId = await store.set(createNewSessionActionAtom, {
    title,
    selectSession: false,
  });
  if (!sessionId) {
    errorNotificationService.showError(
      'Could not start a session for that comment',
      'The @agent mention was saved, but no session could be created for it.',
    );
    return;
  }

  const documentContext = {
    filePath: undefined,
    content: undefined,
    fileType: undefined,
    attachments: undefined,
    mode: 'agent',
    inputType: 'user' as const,
  };

  let provider: string | null = null;
  try {
    const result = (await window.electronAPI.invoke(
      'sessions:get',
      sessionId,
    )) as { session?: { provider?: string } } | null;
    provider = result?.session?.provider ?? null;
  } catch {
    /* fall through to the SDK send path */
  }

  try {
    if (isClaudeCliTerminalSession(provider)) {
      await window.electronAPI.invoke(
        'ai:createQueuedPrompt',
        sessionId,
        request.prompt,
        [],
        documentContext,
      );
    } else {
      await window.electronAPI.invoke(
        'ai:sendMessage',
        request.prompt,
        documentContext,
        sessionId,
        workspacePath,
      );
    }
    errorNotificationService.showInfo(
      'Session started for this comment',
      `${title}. It will reply in the thread when it is done.`,
    );
  } catch (error) {
    errorNotificationService.showError(
      'Could not hand that comment to a session',
      error instanceof Error ? error.message : String(error),
    );
  }
}
