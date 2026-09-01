// @vitest-environment node
/**
 * The tree matcher must refuse a diff it cannot afford (#4821).
 *
 * `pairCost` / `alignChildren` allocate an m*n matrix and memoize a cost per
 * cell for every pair of siblings they align. A 194KB markdown file with a few
 * thousand top-level blocks on each side pushed that memo past V8's ~16.7M
 * `Map` entry cap: the renderer main thread blocked for ~31s and then threw
 * "Map maximum size exceeded", so the user paid the whole freeze for no diff.
 */
import {describe, expect, it} from 'vitest';

import type {SerializedLexicalNode} from 'lexical';

import type {CanonicalTreeNode} from '../../../core/canonicalTree';
import {
  DEFAULT_MAX_PAIR_EVALUATIONS,
  DiffBudgetExceededError,
  diffTrees,
} from '../../../core/ThresholdedOrderPreservingTree';

let nextId = 0;

function para(text: string): CanonicalTreeNode {
  const id = nextId++;
  return {
    id,
    key: `k${id}`,
    type: 'paragraph',
    text,
    children: [],
    serialized: {type: 'paragraph', version: 1} as SerializedLexicalNode,
  };
}

function root(children: CanonicalTreeNode[]): CanonicalTreeNode {
  const id = nextId++;
  return {
    id,
    key: `root${id}`,
    type: 'root',
    children,
    serialized: {type: 'root', version: 1} as SerializedLexicalNode,
  };
}

describe('diffTrees pair budget', () => {
  it('refuses an over-budget alignment instead of exhausting the memo', () => {
    // 4200x4200 is ~17.6M cells -- just past the V8 Map cap that produced the
    // original crash, and ~9x the default budget.
    const source = root(Array.from({length: 4200}, (_, i) => para(`source line ${i}`)));
    const target = root(Array.from({length: 4200}, (_, i) => para(`target line ${i}`)));

    const started = Date.now();
    let thrown: unknown;
    try {
      diffTrees(source, target);
    } catch (error) {
      thrown = error;
    }
    const elapsedMs = Date.now() - started;

    expect(thrown).toBeInstanceOf(DiffBudgetExceededError);
    expect((thrown as DiffBudgetExceededError).budget).toBe(DEFAULT_MAX_PAIR_EVALUATIONS);
    // The whole point is that the bail is O(1): it must happen before the
    // matrix is allocated, not after minutes of work.
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('still diffs a document that fits inside the budget', () => {
    const source = root([para('alpha'), para('beta'), para('gamma')]);
    const target = root([para('alpha'), para('wholly unrelated wording'), para('gamma')]);

    const ops = diffTrees(source, target);

    const leafOps = ops.filter(
      (op) =>
        ('aPath' in op && op.aPath.length === 1) || ('bPath' in op && op.bPath.length === 1),
    );
    expect(leafOps.map((op) => op.op)).toEqual(['equal', 'replace', 'equal']);
  });
});
