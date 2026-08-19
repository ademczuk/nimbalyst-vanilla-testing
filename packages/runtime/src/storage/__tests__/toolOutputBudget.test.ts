// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  capAppServerItemParamsForStorage,
  capClaudeCodeChunkForStorage,
  capToolResultContent,
  capToolResultText,
  STORAGE_TOOL_RESULT_BUDGET_BYTES,
} from '../toolOutputBudget';
import { isNonRenderingAppServerItemStarted } from '../../ai/server/transcript/parsers/CodexAppServerRawParser';

const OVER_BUDGET = 'x'.repeat(STORAGE_TOOL_RESULT_BUDGET_BYTES * 3);

function toolResultChunk(content: unknown) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ tool_use_id: 'toolu_01', type: 'tool_result', content }],
    },
  };
}

describe('capToolResultText', () => {
  it('leaves output within budget byte-identical', () => {
    const small = 'ok\n'.repeat(100);
    expect(capToolResultText(small)).toBe(small);
  });

  it('keeps both the head and the tail of oversized output', () => {
    // The failure this guards: a head-only cap discards the error at the end of
    // a long log, which is the one line anyone scrolls back for.
    const text = `START-OF-LOG\n${'filler line\n'.repeat(200_000)}FATAL: the actual error`;
    const capped = capToolResultText(text);

    expect(capped.length).toBeLessThan(text.length);
    expect(capped).toContain('START-OF-LOG');
    expect(capped).toContain('FATAL: the actual error');
    expect(capped).toContain('elided to bound local storage');
  });

  it('collapses the SDK persisted-output stub regardless of budget', () => {
    const stub = `<persisted-output>\nOutput too large (5.6MB). Full output saved to: /tmp/out.txt\n${'z'.repeat(6_000_000)}`;
    const capped = capToolResultText(stub);

    expect(capped).toContain('/tmp/out.txt');
    expect(capped.length).toBeLessThan(10_000);
  });
});

describe('capToolResultContent', () => {
  it('never elides image blocks, and does not let them consume the text budget', () => {
    const image = { type: 'image', source: { type: 'base64', data: 'A'.repeat(300_000) } };
    const content = [{ type: 'text', text: OVER_BUDGET }, image];

    const out = capToolResultContent(content) as unknown[];

    expect(out[1]).toBe(image);
    expect(JSON.stringify(out[0]).length).toBeLessThan(OVER_BUDGET.length);
  });

  it('returns the input by reference when nothing exceeds budget', () => {
    const content = [{ type: 'text', text: 'short' }];
    expect(capToolResultContent(content)).toBe(content);
  });
});

describe('capClaudeCodeChunkForStorage', () => {
  it('caps tool_result blocks', () => {
    const chunk = toolResultChunk(OVER_BUDGET);
    const out = capClaudeCodeChunkForStorage(chunk) as typeof chunk;

    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(chunk).length);
    expect(out.message.content[0].tool_use_id).toBe('toolu_01');
    expect(out.message.content[0].type).toBe('tool_result');
  });

  it('never caps a tool_use block, however large', () => {
    // Rule 1: a 65 KB plan file written by the agent lives in the CALL. Capping
    // it would corrupt Edit diffs, which are rebuilt from these arguments.
    const bigFile = 'line of a plan document\n'.repeat(20_000);
    const chunk = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_02', name: 'Write', input: { content: bigFile } },
        ],
      },
    };

    const out = capClaudeCodeChunkForStorage(chunk);

    expect(out).toBe(chunk);
    expect((out as typeof chunk).message.content[0].input.content).toBe(bigFile);
  });

  it('does not mutate the chunk the live dispatch loop is still using', () => {
    const chunk = toolResultChunk(OVER_BUDGET);
    capClaudeCodeChunkForStorage(chunk);
    expect(chunk.message.content[0].content).toBe(OVER_BUDGET);
  });

  it('returns the input by reference when nothing exceeds budget', () => {
    const chunk = toolResultChunk('fine');
    expect(capClaudeCodeChunkForStorage(chunk)).toBe(chunk);
  });
});

describe('codex app-server storage rules', () => {
  it('caps aggregatedOutput but preserves the fields the tool card renders', () => {
    const params = {
      item: {
        id: 'exec-1',
        type: 'commandExecution',
        status: 'completed',
        command: '/bin/zsh -lc "npm test"',
        exitCode: 1,
        aggregatedOutput: OVER_BUDGET,
      },
    };

    const out = capAppServerItemParamsForStorage(params) as typeof params;

    expect(out.item.aggregatedOutput.length).toBeLessThan(OVER_BUDGET.length);
    expect(out.item.exitCode).toBe(1);
    expect(out.item.command).toBe('/bin/zsh -lc "npm test"');
    expect(out.item.status).toBe('completed');
    // The live protocol object must not be mutated.
    expect(params.item.aggregatedOutput).toBe(OVER_BUDGET);
  });

  it('drops item/started only for types that render nothing', () => {
    for (const type of ['reasoning', 'agentMessage', 'commandExecution', 'fileChange']) {
      expect(isNonRenderingAppServerItemStarted(type)).toBe(true);
    }
  });

  it('keeps item/started for tool items that render a widget before completing', () => {
    // Regression guard: mcpToolCall and collabAgentToolCall render their widget
    // off tool_call_started, and item/completed does not fire until after the
    // user clicks through. Dropping these strands durable prompts (commit
    // proposal, AskUserQuestion) on "Thinking..." forever.
    expect(isNonRenderingAppServerItemStarted('mcpToolCall')).toBe(false);
    expect(isNonRenderingAppServerItemStarted('collabAgentToolCall')).toBe(false);
    // Generic tool-like items (webSearch, imageView, ...) also render at start.
    expect(isNonRenderingAppServerItemStarted('webSearch')).toBe(false);
    expect(isNonRenderingAppServerItemStarted(undefined)).toBe(false);
  });
});
