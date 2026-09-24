// @vitest-environment node
/**
 * Round-trip tests for tracker reference markdown handling.
 *
 * A tracker reference is stored as `[NIM-123](nimbalyst://NIM-123)` and must:
 *  - import into a TrackerReferenceNode carrying ONLY the reference key,
 *  - export back to the same markdown,
 *  - not be captured by the document-link transformer (which excludes `://`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createEditor, $getRoot } from 'lexical';
import { ListNode, ListItemNode } from '@lexical/list';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { CodeNode } from '@lexical/code';
import { LinkNode } from '@lexical/link';
import { $convertToMarkdownString, type Transformer } from '@lexical/markdown';
import { $convertFromEnhancedMarkdownString } from '../../../editor/markdown/EnhancedMarkdownImport';
import { CORE_TRANSFORMERS } from '../../../editor/markdown/core-transformers';
import {
  TrackerReferenceNode,
  $createTrackerReferenceNode,
  $isTrackerReferenceNode,
} from '../TrackerReferenceNode';
import { TrackerReferenceTransformer } from '../TrackerReferenceTransformer';

function getTestTransformers(): Transformer[] {
  return [TrackerReferenceTransformer, ...CORE_TRANSFORMERS];
}

function makeEditor(): ReturnType<typeof createEditor> {
  return createEditor({
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      CodeNode,
      LinkNode,
      TrackerReferenceNode,
    ],
    onError: (e) => {
      throw e;
    },
  });
}

describe('TrackerReferenceTransformer', () => {
  let editor: ReturnType<typeof createEditor>;

  beforeEach(() => {
    editor = makeEditor();
  });

  it.each(['chip', 'card', 'statements'] as const)('round-trips %s JSON without changing legacy chip JSON', (view) => {
    editor.update(() => {
      const node = $createTrackerReferenceNode('NIM-123', view);
      const json = node.exportJSON();
      expect(json).toEqual({ type: 'tracker-reference', version: 1, referenceKey: 'NIM-123', ...(view === 'chip' ? {} : { view }) });
      expect(TrackerReferenceNode.importJSON(json).getView()).toBe(view);
      expect(TrackerReferenceNode.clone(node).getView()).toBe(view);
      const changed = node.setView(view === 'chip' ? 'card' : 'chip');
      expect(changed.getView()).toBe(view === 'chip' ? 'card' : 'chip');
    }, { discrete: true });
  });

  it('defaults missing and unknown serialized views to chip', () => {
    editor.update(() => {
      for (const view of [undefined, 'future-view']) {
        const node = TrackerReferenceNode.importJSON({ type: 'tracker-reference', version: 1, referenceKey: 'NIM-123', view } as Parameters<typeof TrackerReferenceNode.importJSON>[0]);
        expect(node.getView()).toBe('chip');
        expect(node.exportJSON()).not.toHaveProperty('view');
      }
    }, { discrete: true });
  });

  it.each(['action', 'auth', 'doc', 'folder', 'install', 'tracker'])('does not claim reserved host %s with a view title', (host) => {
    expect(TrackerReferenceTransformer.importRegExp!.exec(`[link](nimbalyst://${host} "view=card")`)).toBeNull();
    expect(TrackerReferenceTransformer.regExp.exec(`[link](nimbalyst://${host} "view=card")`)).toBeNull();
  });

  it.each([
    ['"view=card" ', 'card'],
    ["'view=card'", 'card'],
    ['(view=statements)', 'statements'],
    ['"view=card height=3"', 'card'],
    ['"height=3 view=card"', 'card'],
    ['"Hover title"', 'chip'],
    ['"view=Card"', 'chip'],
    ['"view= card"', 'chip'],
  ])('normalizes title %s to %s', (title, view) => {
    editor.update(() => {
      $convertFromEnhancedMarkdownString(`[label](nimbalyst://NIM-123 ${title})`, getTestTransformers());
      const node = $getRoot().getFirstDescendant();
      expect($isTrackerReferenceNode(node)).toBe(true);
      expect((node as TrackerReferenceNode).getView()).toBe(view);
      const expectedTitle = view === 'chip' ? '' : ` "view=${view}"`;
      expect($convertToMarkdownString(getTestTransformers())).toBe(`[NIM-123](nimbalyst://NIM-123${expectedTitle})`);
    }, { discrete: true });
  });

  it('does not claim images with tracker view titles', () => {
    const markdown = '![image](nimbalyst://NIM-123 "view=card")';
    expect(TrackerReferenceTransformer.importRegExp!.exec(markdown)).toBeNull();
    expect(TrackerReferenceTransformer.regExp.exec(markdown)).toBeNull();
  });

  it('imports a nimbalyst:// link into a TrackerReferenceNode with only the key', () => {
    editor.update(
      () => {
        $convertFromEnhancedMarkdownString(
          'See [NIM-123](nimbalyst://NIM-123) for details.',
          getTestTransformers(),
        );
      },
      { discrete: true },
    );

    let found: TrackerReferenceNode | null = null;
    editor.read(() => {
      const walk = (node: ReturnType<typeof $getRoot>) => {
        for (const child of node.getChildren?.() ?? []) {
          if ($isTrackerReferenceNode(child)) {
            found = child;
          } else if ('getChildren' in child) {
            // @ts-expect-error recursive element walk
            walk(child);
          }
        }
      };
      walk($getRoot());
    });

    expect(found).not.toBeNull();
    expect(found!.getReferenceKey()).toBe('NIM-123');
  });

  it('round-trips [NIM-123](nimbalyst://NIM-123) back to identical markdown', () => {
    editor.update(
      () => {
        $convertFromEnhancedMarkdownString(
          'See [NIM-123](nimbalyst://NIM-123) for details.',
          getTestTransformers(),
        );
      },
      { discrete: true },
    );

    let exported = '';
    editor.update(
      () => {
        exported = $convertToMarkdownString(getTestTransformers());
      },
      { discrete: true },
    );

    expect(exported).toContain('[NIM-123](nimbalyst://NIM-123)');
  });

  it('supports local short-id reference keys (tk_...)', () => {
    editor.update(
      () => {
        $convertFromEnhancedMarkdownString(
          '[tk_a1b2c3](nimbalyst://tk_a1b2c3)',
          getTestTransformers(),
        );
      },
      { discrete: true },
    );

    let exported = '';
    editor.update(
      () => {
        exported = $convertToMarkdownString(getTestTransformers());
      },
      { discrete: true },
    );

    expect(exported).toContain('[tk_a1b2c3](nimbalyst://tk_a1b2c3)');
  });

  it('does not claim app-action links', () => {
    expect(
      TrackerReferenceTransformer.importRegExp!.exec(
        '[Open projects](nimbalyst://action/open-project-manager)',
      ),
    ).toBeNull();
    expect(
      TrackerReferenceTransformer.regExp.exec(
        '[Open projects](nimbalyst://action/open-project-manager)',
      ),
    ).toBeNull();
  });
});
