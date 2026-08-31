/**
 * Main-process wiring for Grok's native question tool.
 *
 * Kept separate from `grokAskUserQuestionPrompt.ts` so the prompt logic can be
 * tested without Electron, the runtime barrel, or the session state manager in
 * its import graph.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { AgentMessagesRepository } from '@nimbalyst/runtime';
import { getSessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import type {
  GrokAskUserQuestionRequest,
  GrokAskUserQuestionResponse,
} from '@nimbalyst/runtime/ai/server/protocols/GrokACPProtocol';
import {
  persistInteractivePromptToolUse,
  persistInteractivePromptToolResult,
} from '../../mcp/tools/interactivePromptTranscript';
import { applyInteractivePromptSettleTurnState } from '../../mcp/tools/interactivePromptSettleState';
import { setSessionPendingPrompt } from './pendingPromptPersistence';
import {
  presentGrokAskUserQuestion,
  GROK_QUESTION_CANCELLED,
  type GrokAskUserQuestionRuntime,
} from './grokAskUserQuestionPrompt';

function defaultRuntime(): GrokAskUserQuestionRuntime {
  return {
    persistToolUse: persistInteractivePromptToolUse,
    persistToolResult: persistInteractivePromptToolResult,
    listRecentMessages: (sessionId, limit) => AgentMessagesRepository.listTail(sessionId, limit),
    subscribe: (channel, listener) => {
      ipcMain.on(channel, listener);
      return () => ipcMain.removeListener(channel, listener);
    },
    setPendingPrompt: (sessionId, pending) => {
      void setSessionPendingPrompt(sessionId, pending, 'decision').catch(() => {});
      if (pending) {
        // Same signal the MCP AskUserQuestion path raises, so every window's
        // session list shows this one as blocked rather than merely running.
        void getSessionStateManager()
          .updateActivity({ sessionId, status: 'waiting_for_input' })
          .catch(() => {});
      }
    },
    onSettled: (sessionId, questionId) => {
      // Restore the running indicator as the turn resumes. Grok runs in-process,
      // so it is not the CLI path that defers to the PID-state watcher.
      void applyInteractivePromptSettleTurnState({
        sessionId,
        isCliSession: false,
        stateManager: getSessionStateManager(),
      }).catch(() => {});
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('ai:askUserQuestionAnswered', { sessionId, questionId });
        }
      }
    },
  };
}

/** Installed on `GrokBuildProvider` at startup (see main/index.ts). */
export function createGrokAskUserQuestionHandler(
  runtime?: GrokAskUserQuestionRuntime,
): (request: GrokAskUserQuestionRequest) => Promise<GrokAskUserQuestionResponse> {
  const resolved = runtime ?? defaultRuntime();
  return (request) => presentGrokAskUserQuestion(request, resolved).catch((error) => {
    console.error('[Grok] AskUserQuestion prompt failed:', error);
    return GROK_QUESTION_CANCELLED;
  });
}
