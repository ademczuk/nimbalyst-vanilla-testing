/**
 * Enhanced markdown import with frontmatter support.
 * This module extends Lexical's markdown import capabilities to:
 * - Parse and store frontmatter metadata in the root node
 * - Handle markdown with or without frontmatter seamlessly
 * - Preserve frontmatter data during editor operations
 */

import { $convertFromMarkdownString, Transformer } from '@lexical/markdown';
import {
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTabNode,
  ElementNode,
  type LexicalNode,
} from 'lexical';

import {
  $setFrontmatter,
  $getFrontmatter,
  parseFrontmatter,
  type FrontmatterData
} from './FrontmatterUtils';

import {
  normalizeMarkdown,
  type NormalizerConfig
} from './MarkdownNormalizer';

/**
 * Options for enhanced markdown import.
 */
export interface EnhancedImportOptions {
  preserveNewLines?: boolean;
  extractFrontmatter?: boolean;
  normalize?: boolean | NormalizerConfig;
}

/**
 * Result of enhanced markdown import.
 */
export interface EnhancedImportResult {
  frontmatter: FrontmatterData | null;
  originalContent?: string;
}

/**
 * File suffixes that once had a dedicated Lexical node writing the linked-image
 * embed form below.
 *
 * This is deliberately an explicit list and NOT "every embeddable suffix". A
 * bare `[![alt](thumb.png)](target.png)` is ordinary, meaningful CommonMark --
 * a clickable thumbnail -- and rewriting one to a plain link would destroy real
 * content. Only a suffix that actually shipped a transformer emitting this shape
 * is safe to reinterpret. Reading the live embeddable registry would be wrong
 * for a second reason too: extensions typically register their file types after
 * a markdown document has already been imported, so the answer here would depend
 * on load order.
 */
const RETIRED_LINKED_IMAGE_EMBED_SUFFIXES = ['.prisma', '.mockup.html'] as const;

const RETIRED_LINKED_IMAGE_EMBED_PATTERN = new RegExp(
  String.raw`\[!\[([^\]]*)\]\([^)]*\)\]\(([^)]*(?:`
  + RETIRED_LINKED_IMAGE_EMBED_SUFFIXES
    .map((suffix) => suffix.replace(/\./g, String.raw`\.`))
    .join('|')
  + String.raw`))\)(?:\{(\d+)x(\d+)\})?`,
  'g',
);

/**
 * Upgrade the retired per-extension embed syntaxes to the universal
 * paragraph-link contract used by EmbeddedFileNode. Keeping these migrations at
 * the markdown import boundary lets old plans repair themselves on their next
 * save without teaching the image transformer about custom editors.
 *
 * Two retired forms:
 *
 *   - `![alt](shot.png){mockup:path}{WxH}` — MockupLM's original brace syntax.
 *   - `[![alt](shot.png)](path){WxH}` — the linked image that both MockupLM and
 *     DataModelLM later wrote from their own Lexical nodes. Those nodes, their
 *     transformers and their insert commands were removed once the neutral
 *     embed covered the same job -- and covered it better, since it mounts the
 *     real editor where the node only ever showed a screenshot.
 *
 * The linked-image form does survive without this pass -- it is already a link
 * whose target is embeddable, so `EmbedExtension` upgrades it -- but the inner
 * image would be its only label, and the `{WxH}` suffix would be left stranded
 * as literal text beside the embed. Rewriting it here keeps the sizing.
 */
export function upgradeLegacyEmbeds(markdown: string): string {
  const toEmbedLink = (
    altText: string,
    embeddedPath: string,
    width?: string,
    height?: string,
  ): string => {
    const title = width && height ? ` "width=${width} height=${height}"` : '';
    return `[${altText || embeddedPath}](${embeddedPath}${title})`;
  };

  return markdown
    .replace(
      /!\[([^\]]*)\]\(([^)]*)\)\{mockup:([^}]+)\}(?:\{(\d+)x(\d+)\})?/g,
      (_match, altText: string, _screenshotPath: string, embeddedPath: string, width?: string, height?: string) =>
        toEmbedLink(altText, embeddedPath, width, height),
    )
    .replace(
      RETIRED_LINKED_IMAGE_EMBED_PATTERN,
      (_match, altText: string, embeddedPath: string, width?: string, height?: string) =>
        toEmbedLink(altText, embeddedPath, width, height),
    );
}

/**
 * Convert markdown string to Lexical nodes with frontmatter support.
 * This function will:
 * 1. Extract frontmatter from the markdown if present
 * 2. Store frontmatter in the root node's internal state
 * 3. Import the content (without frontmatter) into Lexical
 *
 * @param markdown - The markdown string to import (may include frontmatter)
 * @param transformers - Array of transformers for markdown conversion
 * @param node - Optional node to append content to (default: root)
 * @param preserveNewLines - Whether to preserve newlines (default: true)
 * @param extractFrontmatter - Whether to extract frontmatter (default: true)
 * @returns Result containing extracted frontmatter data
 */
export function $convertFromEnhancedMarkdownString(
  markdown: string,
  transformers?: Array<Transformer>,
  node?: ElementNode,
  preserveNewLines: boolean = true,
  extractFrontmatter: boolean = true,
  normalize: boolean | NormalizerConfig = true
): EnhancedImportResult {
  // Normalize CRLF line endings to LF before any processing.
  // Files with Windows line endings cause regex failures in Lexical's
  // multiline transformers (e.g. mermaid, code blocks) because `$` in
  // regexes doesn't match before `\r`.
  const normalizedMarkdown = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let content = normalizedMarkdown;
  let frontmatter: FrontmatterData | null = null;
  let originalContent: string | undefined;

  // Extract and store frontmatter if requested
  if (extractFrontmatter) {
    const parsed = parseFrontmatter(normalizedMarkdown);
    content = parsed.content;
    frontmatter = parsed.data;
    originalContent = parsed.orig;

    // Store frontmatter in the root node
    if (frontmatter) {
      $setFrontmatter(frontmatter);
    }
  }

  content = upgradeLegacyEmbeds(content);

  // Normalize the markdown if requested
  if (normalize) {
    const normalizerConfig = typeof normalize === 'boolean'
      ? { targetIndentSize: 2 } // Normalize to 2-space indents - our standard!
      : normalize;
    content = normalizeMarkdown(content, normalizerConfig);
  }

  // Import via upstream Lexical's $convertFromMarkdownString. Our 2-space
  // list house style is handled by the MarkdownNormalizer pre-pass above and
  // by ListTransformers' export side; the importer itself accepts any
  // indent size that matches a list-item regex.
  //
  // The export side encodes literal `*`/`_` adjacent to emphasis runs as
  // HTML numeric character references, so upstream's CommonMark emphasis
  // scanner (which classifies `\` as non-punctuation) re-imports our exports
  // without losing emphasis spans. See exportTextFormat in
  // EnhancedMarkdownExport for the rationale.
  $convertFromMarkdownString(content, transformers || [], node, preserveNewLines);

  // Upstream splits literal tab characters in text nodes into TabNodes
  // (registered automatically by core Lexical). Our DiffPlugin's tree matcher
  // doesn't know how to align text+tab+text+tab+text spans against the same
  // logical paragraph, which corrupts diffs that contain tab whitespace. The
  // forked import path used to leave tabs as plain characters inside their
  // surrounding TextNodes, so collapse upstream's TabNodes back to text here
  // to preserve that behavior until the diff system grows TabNode awareness.
  $collapseTabNodes(node ?? $getRoot());

  return {
    frontmatter,
    originalContent,
  };
}

function $collapseTabNodes(root: ElementNode): void {
  const visit = (node: LexicalNode): void => {
    if ($isTabNode(node)) {
      node.replace($createTextNode('\t'));
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child);
      }
    }
  };
  visit(root);
}

/**
 * Helper function to update frontmatter in the current editor state.
 * This can be called after the initial import to modify frontmatter data.
 *
 * @param data - The frontmatter data to set (null to clear)
 */
export function $updateFrontmatter(data: FrontmatterData | null): void {
  $setFrontmatter(data);
}

/**
 * Helper function to merge new frontmatter data with existing data.
 * Useful for incrementally updating metadata without overwriting everything.
 *
 * @param newData - The new frontmatter data to merge
 */
export function $mergeFrontmatter(newData: FrontmatterData): void {
  const existing = $getFrontmatter();
  const merged = {
    ...existing,
    ...newData,
  };
  $setFrontmatter(merged);
}

// Re-export getFrontmatter for convenience
export { $getFrontmatter } from './FrontmatterUtils';

/**
 * Convert markdown to Lexical nodes and return both the nodes and frontmatter.
 * This is useful for processing markdown without immediately updating the editor.
 *
 * @param markdown - The markdown string to process
 * @param transformers - Array of transformers for markdown conversion
 * @returns Parsed content and frontmatter data
 */
export function parseEnhancedMarkdown(
  markdown: string,
  transformers?: Array<Transformer>
): {
  content: string;
  frontmatter: FrontmatterData | null;
  transformers: Array<Transformer>;
} {
  const parsed = parseFrontmatter(markdown);

  return {
    content: parsed.content,
    frontmatter: parsed.data,
    transformers: transformers || [],
  };
}
