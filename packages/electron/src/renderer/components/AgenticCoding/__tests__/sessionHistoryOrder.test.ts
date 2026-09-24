// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCommittedRankBuilder, createSessionOrder, getLiveSessionOrderTimestamp } from '../sessionHistoryOrder';

const a = { id: 'a', createdAt: 10, updatedAt: 30 };
const b = { id: 'b', createdAt: 20, updatedAt: 25 };

describe('session history ordering', () => {
  it('uses creation time, message time, or turn boundaries for the selected mode', () => {
    const options = { sortBy: 'updated' as const, mode: 'agent' as const, turnActivity: new Map([['a', 50]]) };
    expect(getLiveSessionOrderTimestamp(a, options)).toBe(50);
    expect(getLiveSessionOrderTimestamp(a, { ...options, mode: 'chat' })).toBe(30);
    expect(getLiveSessionOrderTimestamp(a, { ...options, sortBy: 'created' })).toBe(10);
    expect(getLiveSessionOrderTimestamp({ ...a, updatedAt: 0 }, { ...options, mode: 'chat' })).toBe(10);
  });

  it('holds displayed order while live turns change, then uses rank and creation time to break ties', () => {
    const options = {
      sortBy: 'updated' as const, mode: 'agent' as const,
      workspaceTurnActivity: new Map([['a', 100]]),
      useThrottledTurnOrdering: true,
      displayOrderTimestampMap: new Map([['a', 5], ['b', 5]]),
      displayOrderRankMap: new Map([['a', 1], ['b', 0]]),
    };
    const held = createSessionOrder(options);
    expect([a, b].sort(held.compareSessionOrder)).toEqual([b, a]);
    expect(held.getDisplayedOrderRank('missing')).toBe(Number.MAX_SAFE_INTEGER);
    expect(createSessionOrder({ ...options, useThrottledTurnOrdering: false }).compareSessionOrder(a, b)).toBeLessThan(0);
    expect(createSessionOrder({ ...options, displayOrderRankMap: new Map() }).compareSessionOrder(a, b)).toBeGreaterThan(0);
    expect(held.getDisplayedOrderTimestamp({ ...a, id: 'z' })).toBe(30);
    const tied = createSessionOrder({ ...options, sortBy: 'created', useThrottledTurnOrdering: false, displayOrderRankMap: new Map() });
    expect(tied.compareSessionOrder(a, { ...a, id: 'z' })).toBeLessThan(0);
  });

  it('commits new timestamps while retaining previous tie order and placing new ties deterministically', () => {
    const registry = new Map([['a', a], ['b', b], ['c', { ...b, id: 'c' }]]);
    const build = createCommittedRankBuilder(registry, new Map([['a', 0], ['b', 1]]));
    expect([...build(new Map([['a', 1], ['b', 1], ['c', 2]])).keys()]).toEqual(['c', 'a', 'b']);
    const fresh = createCommittedRankBuilder(registry, new Map());
    expect([...fresh(new Map()).keys()]).toEqual(['b', 'c', 'a']);
  });
});
