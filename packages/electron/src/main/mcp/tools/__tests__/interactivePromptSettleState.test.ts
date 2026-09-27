// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { SessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import type { SessionStateEvent } from '@nimbalyst/runtime/ai/server/types/SessionState';
import { applyInteractivePromptSettleTurnState } from '../interactivePromptSettleState';

function createManager() {
  const sm = new SessionStateManager();
  const statusWrites: string[] = [];
  sm.setDatabase({
    query: async (sql: string, params?: unknown[]) => {
      if (/UPDATE ai_sessions SET status/i.test(sql) && params) statusWrites.push(String(params[0]));
      return { rows: [] };
    },
  });
  const events: string[] = [];
  sm.subscribe((e: SessionStateEvent) => events.push(e.type));
  return { sm, statusWrites, events };
}

describe('applyInteractivePromptSettleTurnState', () => {
  it('re-asserts running when the prompt settles mid-turn', async () => {
    const { sm, events } = createManager();
    await sm.startSession({ sessionId: 's1', workspacePath: '/w', initialStatus: 'running' });
    await sm.updateActivity({ sessionId: 's1', status: 'waiting_for_input' });

    await applyInteractivePromptSettleTurnState({ sessionId: 's1', isCliSession: false, stateManager: sm });

    expect(sm.getSessionState('s1')?.status).toBe('running');
    expect(events[events.length - 1]).toBe('session:streaming');
  });

  // The turn ended (provider error, stop) while the widget was still open; the MCP
  // call then settled via client-abort a minute later. Writing `running` then
  // resurrected the session in the DB with nothing left to ever end it.
  it('does not revive a session whose turn already ended', async () => {
    const { sm, statusWrites, events } = createManager();
    await sm.startSession({ sessionId: 's2', workspacePath: '/w', initialStatus: 'running' });
    await sm.updateActivity({ sessionId: 's2', status: 'waiting_for_input' });
    await sm.endSession('s2');
    statusWrites.length = 0;
    events.length = 0;

    await applyInteractivePromptSettleTurnState({ sessionId: 's2', isCliSession: false, stateManager: sm });

    expect(statusWrites).toEqual([]);
    expect(events).toEqual([]);
  });
});
