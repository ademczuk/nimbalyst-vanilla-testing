// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SNIPPET_MAX_CHARS, latestAssistantTextSql, toSnippetLine } from '../sessionSnippets';

describe('toSnippetLine', () => {
  it('takes the last meaningful line, since that is where the turn got to', () => {
    expect(toSnippetLine('Let me check the config.\n\nFound it: the port was wrong.'))
      .toBe('Found it: the port was wrong.');
  });

  it('strips markdown scaffolding that reads as noise at this size', () => {
    expect(toSnippetLine('## Result\n- **Fixed** the `race` in _paint_')).toBe('Fixed the race in paint');
    expect(toSnippetLine('1. Ran the suite')).toBe('Ran the suite');
  });

  it('ignores code fences so a snippet is never a bare ```', () => {
    expect(toSnippetLine('Here:\n```ts\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('collapses whitespace and truncates with an ellipsis', () => {
    const long = `${'word '.repeat(60)}end`;
    const line = toSnippetLine(long)!;
    expect(line.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
    expect(line.endsWith('…')).toBe(true);
    expect(line).not.toMatch(/\s{2,}/);
  });

  it('returns null rather than an empty row for content with no text', () => {
    expect(toSnippetLine('')).toBeNull();
    expect(toSnippetLine('   \n\n  ')).toBeNull();
    expect(toSnippetLine('###')).toBeNull();
    expect(toSnippetLine(null)).toBeNull();
    expect(toSnippetLine(undefined)).toBeNull();
  });
});

describe('latestAssistantTextSql', () => {
  it('returns null for an empty set rather than emitting `IN ()`', () => {
    expect(latestAssistantTextSql([])).toBeNull();
  });

  it('drops ids that are not plain identifiers instead of interpolating them', () => {
    // Session ids come from our own cache, but this is the one place a value
    // reaches raw SQL, so it must not depend on that staying true.
    const sql = latestAssistantTextSql(["ok-1", "bad'; DROP TABLE ai_sessions; --"]);
    expect(sql).toContain("'ok-1'");
    expect(sql).not.toContain('DROP TABLE');
  });

  it('returns null when every id is rejected', () => {
    expect(latestAssistantTextSql(["'; --"])).toBeNull();
  });

  it('filters to assistant rows that actually carry text', () => {
    const sql = latestAssistantTextSql(['a'])!;
    expect(sql).toContain("message_kind = 'assistant'");
    expect(sql).toContain('searchable_text IS NOT NULL');
  });
});
