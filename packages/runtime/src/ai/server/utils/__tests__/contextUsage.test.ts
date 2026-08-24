// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseContextUsageMessage, normalizeStructuredContextUsage } from '../contextUsage';

// Captured verbatim from `claude --print --output-format stream-json "/context"`
// on agent-SDK 0.3.241. The markdown and the structured field are two renderings
// of the same report, delivered on the same assistant message.
const CONTEXT_MARKDOWN = `## Context Usage

**Model:** claude-haiku-4-5-20251001
**Tokens:** 38.3k / 200k (19%)

### Estimated usage by category

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 6.5k | 3.3% |
| Memory files | 17.2k | 8.6% |
| Free space | 158.7k | 79.3% |
`;

const CONTEXT_STRUCTURED = {
  model: 'claude-haiku-4-5-20251001',
  total_tokens: 38334,
  raw_max_tokens: 200000,
  percentage: 19,
  categories: [
    { name: 'System prompt', tokens: 6509, kind: 'used' },
    { name: 'Memory files', tokens: 17225, kind: 'used' },
    { name: 'Free space', tokens: 158666, kind: 'free' },
  ],
};

describe('normalizeStructuredContextUsage', () => {
  it('reads the exact totals the markdown can only express rounded', () => {
    const structured = normalizeStructuredContextUsage(CONTEXT_STRUCTURED);
    const scraped = parseContextUsageMessage(CONTEXT_MARKDOWN);

    // Same report, so the window agrees exactly...
    expect(structured!.contextWindow).toBe(200_000);
    expect(scraped!.contextWindow).toBe(200_000);
    // ...but the markdown is rendered to three significant figures, so the
    // scraped total is off by the rounding. This is the reason to prefer it.
    expect(structured!.totalTokens).toBe(38_334);
    expect(scraped!.totalTokens).toBe(38_300);
  });

  it('derives each category percentage against the window', () => {
    const usage = normalizeStructuredContextUsage(CONTEXT_STRUCTURED);

    expect(usage!.categories).toEqual([
      { name: 'System prompt', tokens: 6509, percentage: 3.3 },
      { name: 'Memory files', tokens: 17225, percentage: 8.6 },
      { name: 'Free space', tokens: 158666, percentage: 79.3 },
    ]);
  });

  it('returns undefined without a usable window so the caller keeps the markdown', () => {
    // The field is optional on older binaries; a zeroed window would render as
    // a confident "0%" instead of falling back to the parse that still works.
    expect(normalizeStructuredContextUsage({ total_tokens: 100, raw_max_tokens: 0 })).toBeUndefined();
    expect(normalizeStructuredContextUsage({ total_tokens: 100 })).toBeUndefined();
    expect(normalizeStructuredContextUsage(undefined)).toBeUndefined();
  });

  it('survives a report with no category breakdown', () => {
    const usage = normalizeStructuredContextUsage({ total_tokens: 10, raw_max_tokens: 200_000 });

    expect(usage).toEqual({ totalTokens: 10, contextWindow: 200_000 });
  });

  it('skips malformed category rows rather than emitting NaN percentages', () => {
    const usage = normalizeStructuredContextUsage({
      total_tokens: 10,
      raw_max_tokens: 200_000,
      categories: [
        { name: 'System prompt', tokens: 6509 },
        { name: '', tokens: 5 },
        { name: 'Bad', tokens: 'lots' },
      ],
    });

    expect(usage!.categories).toEqual([
      { name: 'System prompt', tokens: 6509, percentage: 3.3 },
    ]);
  });
});
