// @vitest-environment node
/**
 * Headless edits to codec-only shared documents (NIM-2640).
 *
 * Documents with no Lexical tree edit their serialized form: read via
 * `exportToFile`, replace text, write via `applyFromFile`. That composition is
 * only safe if a codec can consume its own output, and nothing else in the
 * codebase asserts that -- a codec whose `applyFromFile` cannot round-trip its
 * `exportToFile` would silently corrupt the document on every agent edit.
 *
 * The real codecs are used here, per type, because that is the property at
 * risk; the dispatch logic itself is covered in `HeadlessCollabDocEdit.test.ts`
 * against a stub.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import type { CollabContentAdapter } from '@nimbalyst/collab-adapters';
import {
  MockupHtmlCollabContentAdapter,
  MockupProjectCollabContentAdapter,
} from '@nimbalyst/mockuplm/collab-adapters';
import { ExcalidrawCollabContentAdapter } from '@nimbalyst/excalidraw-extension/collab-adapter';
import { canvasCollabCodec } from '@nimbalyst/runtime/canvas';
import { CalcSheetCollabContentAdapter } from '@nimbalyst/extension-calc-sheets/collab-adapter';
import { CsvCollabContentAdapter } from '@nimbalyst/extension-csv-spreadsheet/collab-adapter';
import { DataModelCollabContentAdapter } from '@nimbalyst/extension-datamodellm/collab-adapter';
import { applyTextReplacementsToString } from '@nimbalyst/runtime/editor/plugins/DiffPlugin/core/diffUtils';
import { CodeCollabContentAdapter } from '../../utils/CodeCollabContentAdapter';

function project(codec: CollabContentAdapter, doc: Y.Doc): string {
  const exported = codec.exportToFile(doc);
  return typeof exported === 'string'
    ? exported
    : new TextDecoder('utf-8').decode(exported);
}

/** The exact composition `applyHeadlessCollabDocEdit` performs for these types. */
function headlessEdit(
  codec: CollabContentAdapter,
  doc: Y.Doc,
  oldText: string,
  newText: string,
): string {
  const original = project(codec, doc);
  codec.applyFromFile(doc, applyTextReplacementsToString(original, [{ oldText, newText }]));
  return project(codec, doc);
}

const CASES: Array<{
  name: string;
  codec: CollabContentAdapter;
  source: string;
  oldText: string;
  newText: string;
}> = [
  {
    name: 'mockup.html',
    codec: MockupHtmlCollabContentAdapter,
    source: '<html><body><button id="save">Save changes</button></body></html>',
    oldText: 'Save changes',
    newText: 'Apply changes',
  },
  {
    name: 'excalidraw',
    codec: ExcalidrawCollabContentAdapter,
    source: JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'nimbalyst',
      elements: [{ id: 'a1', type: 'text', text: 'Before' }],
      appState: {},
      files: {},
    }),
    oldText: '"Before"',
    newText: '"After"',
  },
];

describe.each(CASES)('headless edit of a $name shared document', ({ codec, source, oldText, newText }) => {
  it('round-trips its own serialization through an agent edit', () => {
    const doc = new Y.Doc();
    codec.seedFromFile(doc, source);

    const result = headlessEdit(codec, doc, oldText, newText);

    expect(result).toContain(newText);
    expect(result).not.toContain(oldText);
  });

  it('leaves the document untouched when the text to replace is absent', () => {
    const doc = new Y.Doc();
    codec.seedFromFile(doc, source);
    const before = project(codec, doc);

    expect(() =>
      headlessEdit(codec, doc, 'text that was never in this document', 'x'),
    ).toThrow();
    expect(project(codec, doc)).toBe(before);
  });
});

/**
 * Every OTHER registered codec, checked for the same round-trip property.
 *
 * The two cases above edit real text because their file form is text a person
 * would recognise. These types serialize to JSON or a schema, where inventing a
 * realistic agent replacement per format adds fixtures without adding coverage:
 * the property that actually decides whether an agent edit corrupts them is
 * whether `applyFromFile(exportToFile(doc))` is a no-op. If that identity does
 * not hold, every edit loses data regardless of what text was replaced.
 */
const IDENTITY_CASES: Array<{ name: string; codec: CollabContentAdapter; source: string }> = [
  {
    name: 'canvas',
    codec: canvasCollabCodec,
    source: JSON.stringify({
      nodes: [{ id: 'n1', type: 'document', x: 0, y: 0, width: 400, height: 300, title: 'Board' }],
      edges: [],
    }),
  },
  {
    name: 'datamodel',
    codec: DataModelCollabContentAdapter,
    source: 'model User {\n  id    String @id\n  email String\n}\n',
  },
  { name: 'csv', codec: CsvCollabContentAdapter, source: 'name,qty\nwidget,3\n' },
  {
    name: 'calc.md',
    codec: CalcSheetCollabContentAdapter,
    source: '# Sheet\n\n| a | b |\n| - | - |\n| 1 | 2 |\n',
  },
  { name: 'code', codec: CodeCollabContentAdapter, source: 'export const answer = 1;\n' },
  {
    name: 'mockupproject',
    codec: MockupProjectCollabContentAdapter,
    source: JSON.stringify({ name: 'Proj', description: 'd', mockups: [], connections: [] }),
  },
];

describe.each(IDENTITY_CASES)('$name shared document', ({ codec, source }) => {
  it('is unchanged by an identity write of its own export', () => {
    const doc = new Y.Doc();
    codec.seedFromFile(doc, source);
    const exported = project(codec, doc);

    codec.applyFromFile(doc, exported);

    expect(project(codec, doc)).toBe(exported);
  });
});
