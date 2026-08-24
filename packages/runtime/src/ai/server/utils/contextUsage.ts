import type { TokenUsageCategory } from '../types';

export interface ParsedContextUsage {
  totalTokens: number;
  contextWindow: number;
  categories?: TokenUsageCategory[];
}

const TOKEN_LINE_REGEX = /\*\*Tokens:\*\*\s+([\d.,]+)([kKmM]?)\s*\/\s*([\d.,]+)([kKmM]?)\s*\((\d+)%\)/i;

/**
 * Read the same report out of the SDK's structured `context_usage` field
 * instead of the rendered markdown.
 *
 * Agent-SDK 0.3.241 attaches `context_usage` to the synthetic assistant message
 * that carries the `/context` table -- the SDK's own words: "structured twin of
 * the /context report ... the markdown in message.content remains the canonical
 * fallback". It is exact where the markdown is rendered to three significant
 * figures (38334 vs "38.3k"), and it does not depend on the CLI's table layout
 * staying byte-stable for `parseContextUsageMessage`'s regexes.
 *
 * Returns undefined -- matching `parseContextUsageMessage` -- whenever the
 * payload is absent or unusable, so callers fall back to the markdown parse on
 * binaries that do not attach it.
 */
export function normalizeStructuredContextUsage(raw: unknown): ParsedContextUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;

  const contextWindow = source.raw_max_tokens;
  if (typeof contextWindow !== 'number' || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return undefined;
  }

  const totalTokens = source.total_tokens;
  if (typeof totalTokens !== 'number' || !Number.isFinite(totalTokens) || totalTokens < 0) {
    return undefined;
  }

  const usage: ParsedContextUsage = {
    totalTokens: Math.round(totalTokens),
    contextWindow: Math.round(contextWindow),
  };

  // The structured rows carry tokens and a `kind`, but no percentage -- the
  // markdown's percentage column is just tokens over the window, so derive it
  // the same way and keep TokenUsageCategory unchanged.
  const rawCategories = source.categories;
  if (Array.isArray(rawCategories)) {
    const categories: TokenUsageCategory[] = [];
    for (const entry of rawCategories) {
      if (!entry || typeof entry !== 'object') continue;
      const { name, tokens } = entry as Record<string, unknown>;
      if (typeof name !== 'string' || !name) continue;
      if (typeof tokens !== 'number' || !Number.isFinite(tokens)) continue;
      categories.push({
        name,
        tokens: Math.round(tokens),
        percentage: Math.round((tokens / usage.contextWindow) * 1000) / 10,
      });
    }
    if (categories.length > 0) usage.categories = categories;
  }

  return usage;
}

/**
 * Extract the actual markdown content from the stored message.
 * The database stores raw SDK chunks as JSON like:
 * {"type":"user","message":{"content":"<local-command-stdout>## Context Usage..."}}
 *
 * This function extracts the markdown from that structure.
 */
function extractMarkdownFromStoredContent(content: string): string {
  let markdown = content;

  // Check if content is a JSON object (starts with { and contains "type")
  if (content.trim().startsWith('{') && content.includes('"type"')) {
    try {
      const parsed = JSON.parse(content);
      // Extract from user message structure
      if (parsed.type === 'user' && typeof parsed.message?.content === 'string') {
        markdown = parsed.message.content;
      }
    } catch {
      // Not valid JSON, use content as-is
    }
  }

  // Strip <local-command-stdout> tags if present
  const match = markdown.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (match && match[1]) {
    markdown = match[1].trim();
  }

  return markdown;
}

/**
 * Parse the markdown emitted by the `/context` command to extract token usage information.
 * Returns undefined if the expected token line cannot be parsed.
 *
 * Handles two formats:
 * 1. Raw JSON from database: {"type":"user","message":{"content":"<local-command-stdout>..."}}
 * 2. Extracted markdown: "## Context Usage\n**Tokens:** 32.9k / 200.0k (16%)\n..."
 */
export function parseContextUsageMessage(content?: string): ParsedContextUsage | undefined {
  if (!content) {
    return undefined;
  }

  // Extract markdown from JSON/XML wrapper if needed
  const markdown = extractMarkdownFromStoredContent(content);

  const tokenMatch = markdown.match(TOKEN_LINE_REGEX);
  if (!tokenMatch) {
    return undefined;
  }

  const totalTokens = convertToTokens(tokenMatch[1], tokenMatch[2]);
  const contextWindow = convertToTokens(tokenMatch[3], tokenMatch[4]);
  const categories = extractCategories(markdown);

  return {
    totalTokens,
    contextWindow,
    categories: categories.length > 0 ? categories : undefined
  };
}

function extractCategories(content: string): TokenUsageCategory[] {
  // Try both old and new format headers
  let categoriesStart = content.indexOf('### Estimated usage by category');
  if (categoriesStart === -1) {
    categoriesStart = content.indexOf('### Categories');
    if (categoriesStart === -1) {
      return [];
    }
  }

  const section = content.slice(categoriesStart);
  const rowRegex = /\|\s*([^|]+?)\s*\|\s*([\d.,]+)([kKmM]?)\s*\|\s*([\d.,]+)%\s*\|/g;
  const categories: TokenUsageCategory[] = [];
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(section)) !== null) {
    const name = match[1].trim();
    const tokens = convertToTokens(match[2], match[3]);
    const percentage = Number.parseFloat(match[4]);

    // Skip header rows
    if (name === 'Category' || name === '---' || !name || Number.isNaN(tokens) || Number.isNaN(percentage)) {
      continue;
    }

    categories.push({
      name,
      tokens,
      percentage
    });
  }

  return categories;
}

function convertToTokens(value: string, suffix?: string): number {
  const normalized = value.replace(/,/g, '').trim();
  const numericValue = Number.parseFloat(normalized);
  if (Number.isNaN(numericValue)) {
    return 0;
  }

  const multiplier = suffix?.toLowerCase() === 'm'
    ? 1_000_000
    : suffix?.toLowerCase() === 'k'
      ? 1_000
      : 1;

  return Math.round(numericValue * multiplier);
}
