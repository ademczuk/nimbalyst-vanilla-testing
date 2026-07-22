/**
 * Regression tests for the node set `MarkdownCollabContentAdapter` hands to its
 * headless Lexical editor.
 *
 * The adapter is registered in the ELECTRON MAIN process
 * (`collabContentAdapterRegistration.ts`), so it hits exactly the failure mode
 * `headlessBodyNodes.ts` was written to fix: it was constructing its headless
 * editor with the minimal `EditorNodes` set, which omits every node a renderer
 * editor extension registers (list, link, auto-link, horizontal rule, ...).
 * Any list- or link-bearing document therefore threw "Node list is not
 * registered" inside `$convertFromEnhancedMarkdownString`, which aborts the
 * whole conversion -- so the Y.Doc was never seeded and `exportToFile` came
 * back empty.
 *
 * That was a missed call site of the `HeadlessBodyNodes` fix.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { MarkdownCollabContentAdapter } from '../MarkdownCollabContentAdapter';
// Side-effect: populate the transformer set (core + built-in extensions) so
// getEditorTransformers() returns the same list the main process uses.
import '../../editor/extensions/registerBuiltinExtensions';

// The shapes that live outside the minimal `EditorNodes` set: bullet list,
// ordered list, link, and a horizontal rule.
const LIST_AND_LINK_MARKDOWN = `## Notes

- first
- second

1. one
2. two

See [the docs](https://example.com/docs).

---

Done.`;

describe('MarkdownCollabContentAdapter node set', () => {
  it('seeds list and link markdown into the Y.Doc instead of aborting', () => {
    const yDoc = new Y.Doc();

    MarkdownCollabContentAdapter.seedFromFile(yDoc, LIST_AND_LINK_MARKDOWN);

    const exported = MarkdownCollabContentAdapter.exportToFile(yDoc);
    const markdown = typeof exported === 'string'
      ? exported
      : new TextDecoder('utf-8').decode(exported as Uint8Array);

    // Every one of these lives outside `EditorNodes` and so was silently lost.
    expect(markdown).toContain('first');
    expect(markdown).toContain('second');
    expect(markdown).toContain('one');
    expect(markdown).toContain('https://example.com/docs');
    expect(markdown).toContain('Done.');
  });

  it('round-trips a list through applyFromFile without dropping the body', () => {
    const yDoc = new Y.Doc();

    // Seed once, then replace -- applyFromFile uses the same wipe-and-reseed
    // path and the same headless node set.
    MarkdownCollabContentAdapter.seedFromFile(yDoc, 'placeholder');
    MarkdownCollabContentAdapter.applyFromFile(yDoc, LIST_AND_LINK_MARKDOWN);

    const exported = MarkdownCollabContentAdapter.exportToFile(yDoc);
    const markdown = typeof exported === 'string'
      ? exported
      : new TextDecoder('utf-8').decode(exported as Uint8Array);

    expect(markdown).not.toContain('placeholder');
    expect(markdown).toContain('first');
    expect(markdown).toContain('https://example.com/docs');
  });

  it('does not duplicate content when reading a populated doc', () => {
    // The headless editor binds to a fresh working doc and replays the source
    // state into it. If that replay echoed back through the bridge, every read
    // would append a second copy of the document.
    const yDoc = new Y.Doc();
    MarkdownCollabContentAdapter.seedFromFile(yDoc, LIST_AND_LINK_MARKDOWN);

    // Read repeatedly -- each read builds a new binding over the same doc.
    MarkdownCollabContentAdapter.exportToFile(yDoc);
    MarkdownCollabContentAdapter.toPlainText(yDoc);
    const exported = MarkdownCollabContentAdapter.exportToFile(yDoc);
    const markdown = typeof exported === 'string'
      ? exported
      : new TextDecoder('utf-8').decode(exported as Uint8Array);

    expect(markdown.match(/first/g) ?? []).toHaveLength(1);
    expect(markdown.match(/Done\./g) ?? []).toHaveLength(1);
    expect(markdown.match(/example\.com\/docs/g) ?? []).toHaveLength(1);
  });
});
