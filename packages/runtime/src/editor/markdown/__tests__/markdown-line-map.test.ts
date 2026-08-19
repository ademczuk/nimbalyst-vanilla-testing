// @vitest-environment node
/**
 * The line map turns a `file.md:653` link into a block to scroll to. Its whole
 * job is arithmetic -- frontmatter height, the newline inserted between
 * consecutive non-empty blocks, multi-line blocks -- and every one of those is
 * invisible on screen when wrong: the reveal just lands a few blocks early.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createEditor } from 'lexical';
import { ListNode, ListItemNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { $convertFromEnhancedMarkdownString } from '../EnhancedMarkdownImport';
import {
  $buildMarkdownLineMap,
  $convertToEnhancedMarkdownString,
  type MarkdownBlockLineRange,
} from '../EnhancedMarkdownExport';
import { CORE_TRANSFORMERS } from '../core-transformers';

function load(editor: ReturnType<typeof createEditor>, markdown: string) {
  let ranges: MarkdownBlockLineRange[] = [];
  let exported = '';
  editor.update(() => {
    $convertFromEnhancedMarkdownString(markdown, CORE_TRANSFORMERS);
    ranges = $buildMarkdownLineMap(CORE_TRANSFORMERS);
    exported = $convertToEnhancedMarkdownString(CORE_TRANSFORMERS);
  });
  return { ranges, exported, lines: exported.split('\n') };
}

/** The text the map claims a block occupies. */
function sliceRange(lines: string[], range: MarkdownBlockLineRange): string {
  return lines.slice(range.startLine - 1, range.endLine).join('\n');
}

describe('$buildMarkdownLineMap', () => {
  let editor: ReturnType<typeof createEditor>;

  beforeEach(() => {
    editor = createEditor({
      nodes: [ListNode, ListItemNode, HeadingNode, QuoteNode, CodeNode, LinkNode],
    });
  });

  it('maps every block onto the exact lines it occupies in the exported file', () => {
    const markdown = `---
planStatus:
  title: Offsets
  progress: 25
---
# Heading

Some prose that follows the heading.

- [ ] first
- [x] second

\`\`\`ts
const a = 1;
const b = 2;
\`\`\`

Closing paragraph.`;

    const { ranges, lines } = load(editor, markdown);

    // Golden: frontmatter pushes the first block to line 6, the list and the
    // fenced block span their full height, and blank lines between blocks are
    // their own (empty paragraph) blocks.
    expect(ranges.map((r) => sliceRange(lines, r))).toEqual([
      '# Heading',
      '',
      'Some prose that follows the heading.',
      '',
      '- [ ] first\n- [x] second',
      '',
      '```ts\nconst a = 1;\nconst b = 2;\n```',
      '',
      'Closing paragraph.',
    ]);

    // Nothing may claim a line past the end of the file.
    expect(Math.max(...ranges.map((r) => r.endLine))).toBeLessThanOrEqual(lines.length);

    // Ranges must be ordered and non-overlapping, or a line resolves ambiguously.
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].startLine).toBeGreaterThan(ranges[i - 1].endLine);
    }
  });

  it('shifts every block down by the height of the frontmatter', () => {
    const body = `# Heading

Prose.`;
    const withFrontmatter = `---
title: Shifted
---
${body}`;

    const plain = load(editor, body);
    editor = createEditor({
      nodes: [ListNode, ListItemNode, HeadingNode, QuoteNode, CodeNode, LinkNode],
    });
    const framed = load(editor, withFrontmatter);

    const frontmatterHeight =
      framed.lines.length - plain.lines.length;
    expect(frontmatterHeight).toBeGreaterThan(0);

    expect(framed.ranges[0].startLine).toBe(plain.ranges[0].startLine + frontmatterHeight);
    expect(framed.lines[framed.ranges[0].startLine - 1]).toBe('# Heading');
  });

  it('spans a fenced code block across all of its lines', () => {
    const markdown = `Intro.

\`\`\`ts
const a = 1;
const b = 2;
const c = 3;
\`\`\`

Outro.`;

    const { ranges, lines } = load(editor, markdown);

    const code = ranges.find((r) => lines[r.startLine - 1].startsWith('```'));
    expect(code).toBeDefined();
    // Opening fence, three statements, closing fence.
    expect(code!.endLine - code!.startLine + 1).toBe(5);
    expect(lines[code!.endLine - 1]).toBe('```');
  });

  it('starts a non-empty block on its content, not on the separator newline', () => {
    // Consecutive non-empty blocks get a '\n' prepended to the second one by
    // the export loop. That blank line belongs to the gap, so the block's range
    // must start below it or every reveal lands one line high.
    const markdown = `# Heading
## Subheading`;

    const { ranges, lines } = load(editor, markdown);

    expect(ranges.map((r) => sliceRange(lines, r))).toEqual(['# Heading', '## Subheading']);
  });
});
