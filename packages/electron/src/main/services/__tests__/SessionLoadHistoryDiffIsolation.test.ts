import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('session-load history diff isolation', () => {
  it('keeps eager history diff enrichment out of load and tail handlers', () => {
    const aiService = readFileSync(new URL('../ai/AIService.ts', import.meta.url), 'utf8');
    const sessionHandlers = readFileSync(new URL('../../ipc/SessionHandlers.ts', import.meta.url), 'utf8');

    expect(aiService).not.toContain('enrichTranscriptMessagesWithToolCallDiffs');
    expect(sessionHandlers).not.toContain('enrichTranscriptMessagesWithToolCallDiffs');
  });
});
