// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { planWorkstreamStatePrune } from '../workstreamStatePrune';

const states = (...ids: string[]) =>
  Object.fromEntries(ids.map(id => [id, { id, splitRatio: 0.5 }]));

describe('planWorkstreamStatePrune', () => {
  it('keeps entries for live sessions and drops the rest', () => {
    const plan = planWorkstreamStatePrune(
      states('live-1', 'archived-1', 'deleted-1', 'live-2'),
      new Set(['live-1', 'live-2']),
    );

    expect(plan.remove.sort()).toEqual(['archived-1', 'deleted-1']);
    expect(plan.keptCount).toBe(2);
  });

  it('does nothing when the session set is empty', () => {
    // An empty set means the query failed or the database was not ready --
    // not that every session was deleted. Pruning here would wipe the lot.
    const plan = planWorkstreamStatePrune(states('a', 'b', 'c'), new Set());

    expect(plan.remove).toEqual([]);
    expect(plan.keptCount).toBe(3);
  });

  it('does nothing when there is nothing to prune', () => {
    const plan = planWorkstreamStatePrune(states('a'), new Set(['a']));
    expect(plan.remove).toEqual([]);
  });

  it('tolerates a missing or empty state bag', () => {
    expect(planWorkstreamStatePrune(undefined, new Set(['a'])).remove).toEqual([]);
    expect(planWorkstreamStatePrune({}, new Set(['a'])).remove).toEqual([]);
  });
});
