/**
 * Headless markdown edits produce a MINIMAL delta.
 *
 * This is the whole reason the markdown path reconciles through the editor
 * instead of taking the codec's cheap `clear + reparse`. A wholesale
 * replacement still ends up with the right text, so asserting on the resulting
 * document cannot tell the two apart -- and the difference is exactly what
 * decides whether a remote collaborator's in-flight edit survives and whether
 * comment anchors stay attached.
 *
 * So these assert on the Yjs UPDATE, not the result. The control case below
 * runs the same assertion against the wipe-and-reseed path and expects the
 * opposite, so a regression cannot pass by making the assertion vacuous.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { MarkdownCollabContentAdapter } from '@nimbalyst/runtime/sync/MarkdownCollabContentAdapter';

import { applyMarkdownReplacementsToYDoc } from '../headlessMarkdownEdit';

const UNTOUCHED = 'Paragraph three is a bystander and must not be rewritten.';
const ORIGINAL = [
  '# Heading',
  '',
  'Paragraph one mentions alpha.',
  '',
  'Paragraph two mentions beta.',
  '',
  UNTOUCHED,
  '',
].join('\n');

/** Yjs stores inserted strings verbatim in the update, so a byte scan works. */
function deltaText(doc: Y.Doc, sinceStateVector: Uint8Array): string {
  return new TextDecoder('latin1').decode(
    Y.encodeStateAsUpdate(doc, sinceStateVector),
  );
}

function seeded(): Y.Doc {
  const doc = new Y.Doc();
  MarkdownCollabContentAdapter.seedFromFile(doc, ORIGINAL);
  return doc;
}

describe('applyMarkdownReplacementsToYDoc', () => {
  it('applies the replacement to the document', () => {
    const doc = seeded();

    applyMarkdownReplacementsToYDoc(doc, [
      { oldText: 'beta', newText: 'BETA' },
    ]);

    const result = MarkdownCollabContentAdapter.exportToFile(doc) as string;
    expect(result).toContain('Paragraph two mentions BETA.');
    expect(result).toContain(UNTOUCHED);
  });

  it('does not rewrite paragraphs it did not touch', () => {
    const doc = seeded();
    const before = Y.encodeStateVector(doc);

    applyMarkdownReplacementsToYDoc(doc, [
      { oldText: 'beta', newText: 'BETA' },
    ]);

    expect(deltaText(doc, before)).not.toContain(UNTOUCHED);
  });

  /**
   * Control. `applyFromFile` is the codec's clear-and-reseed, the path this
   * design deliberately avoids for markdown. If it ever stops re-inserting the
   * untouched paragraph, the assertion above has stopped proving anything.
   */
  it('control: the codec clear-and-reseed DOES rewrite untouched paragraphs', () => {
    const doc = seeded();
    const before = Y.encodeStateVector(doc);

    MarkdownCollabContentAdapter.applyFromFile(
      doc,
      ORIGINAL.replace('beta', 'BETA'),
    );

    expect(deltaText(doc, before)).toContain(UNTOUCHED);
  });

  /**
   * The node set is the whole ballgame for this path, and the fixture above
   * cannot catch a gap in it: plain paragraphs need almost no nodes registered.
   *
   * With `EditorNodes` (which omits list/link/image -- a mounted editor gets
   * those from the extension graph, and a standalone headless editor does NOT)
   * the binding threw "Node list is not registered", the editor state came up
   * EMPTY, and the edit then failed as `Old text "..." not found`. That message
   * blames the agent's quote for a document that never loaded, so the real
   * cause is invisible from the tool result.
   */
  it.each([
    ['a bullet list', '# Title\n\n- one\n- two\n\nParagraph mentions alpha.\n'],
    ['a link', '# Title\n\nSee [docs](https://example.com).\n\nParagraph mentions alpha.\n'],
  ])('edits a document containing %s', (_label, markdown) => {
    const doc = new Y.Doc();
    MarkdownCollabContentAdapter.seedFromFile(doc, markdown);

    applyMarkdownReplacementsToYDoc(doc, [{ oldText: 'alpha', newText: 'ALPHA' }]);

    expect(MarkdownCollabContentAdapter.exportToFile(doc)).toContain('ALPHA');
  });

  it('throws rather than guessing when the text to replace is absent', () => {
    const doc = seeded();

    expect(() =>
      applyMarkdownReplacementsToYDoc(doc, [
        { oldText: 'text that was never in this document', newText: 'x' },
      ]),
    ).toThrow();
    expect(MarkdownCollabContentAdapter.exportToFile(doc)).toContain(UNTOUCHED);
  });

  /**
   * The case above only exercises prose. A LIST-shaped `oldText` takes a
   * different branch: on a failed match the mounted editor reconstructs a
   * target markdown by locating the first list in the document and replacing
   * it, then reports success. Here that silently deleted the shipping blockers
   * -- a list the agent never referred to -- and acknowledged the write to
   * every collaborator.
   */
  it('does not rewrite a different list when a list-shaped match fails', () => {
    const doc = new Y.Doc();
    MarkdownCollabContentAdapter.seedFromFile(
      doc,
      [
        '# Release checklist',
        '',
        '## Shipping blockers',
        '',
        '- audit the key rotation',
        '- verify the backup restore',
        '',
        '## Nice to have',
        '',
        '- tidy the settings icons',
        '- rename the export button',
        '',
      ].join('\n'),
    );

    expect(() =>
      applyMarkdownReplacementsToYDoc(doc, [
        {
          // The "Nice to have" list, quoted imperfectly.
          oldText: '- tidy the settings icons\n- rename the export buttons',
          newText: '- tidy the settings icons',
        },
      ]),
    ).toThrow();

    const after = MarkdownCollabContentAdapter.exportToFile(doc) as string;
    expect(after).toContain('audit the key rotation');
    expect(after).toContain('verify the backup restore');
  });
});
