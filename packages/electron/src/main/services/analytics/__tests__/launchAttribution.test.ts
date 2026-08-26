// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { bucketDaysSinceInstall, bucketLaunchNumber, decideLaunch, type LaunchState } from '../launchAttribution';

const DAY = 86_400_000;

describe('launch decision across boots', () => {
  // The interesting behavior is entirely on the second launch. A function that
  // is only exercised by starting the real app twice is a function nobody
  // tests, so this is the case that has to exist.
  it('records the install date on first launch and counts it as launch 1', () => {
    const now = Date.parse('2026-08-26T00:00:00.000Z');
    const { next, launchNumber, daysSinceInstall } = decideLaunch({}, now);

    expect(launchNumber).toBe(1);
    expect(daysSinceInstall).toBe(0);
    expect(next.firstLaunchAt).toBe('2026-08-26T00:00:00.000Z');
    expect(next.launchCount).toBe(1);
  });

  it('keeps the original install date and increments on the second launch', () => {
    const first = decideLaunch({}, Date.parse('2026-08-01T00:00:00.000Z'));
    const second = decideLaunch(first.next, Date.parse('2026-08-04T00:00:00.000Z'));

    expect(second.launchNumber).toBe(2);
    expect(second.daysSinceInstall).toBe(3);
    // The install date must NOT be rewritten to "now" -- that would peg every
    // returning user at day 0 and make retention unmeasurable.
    expect(second.next.firstLaunchAt).toBe(first.next.firstLaunchAt);
  });

  it('does not go backwards if the clock does', () => {
    const first = decideLaunch({}, Date.parse('2026-08-10T00:00:00.000Z'));
    const skewed = decideLaunch(first.next, Date.parse('2026-08-01T00:00:00.000Z'));
    expect(skewed.daysSinceInstall).toBe(0);
    expect(skewed.launchNumber).toBe(2);
  });

  it('survives an unparseable stored install date without emitting NaN', () => {
    const state: LaunchState = { firstLaunchAt: 'not-a-date', launchCount: 4 };
    const { launchNumber, daysSinceInstall } = decideLaunch(state, Date.parse('2026-08-26T00:00:00.000Z'));
    expect(launchNumber).toBe(5);
    expect(daysSinceInstall).toBe(0);
    expect(Number.isNaN(daysSinceInstall)).toBe(false);
  });

  it('accumulates over many launches', () => {
    let state: LaunchState = {};
    let last = decideLaunch(state, Date.parse('2026-08-01T00:00:00.000Z'));
    for (let i = 1; i < 25; i++) {
      last = decideLaunch(last.next, Date.parse('2026-08-01T00:00:00.000Z') + i * DAY);
      state = last.next;
    }
    expect(last.launchNumber).toBe(25);
    expect(bucketLaunchNumber(last.launchNumber)).toBe('20+');
    expect(last.daysSinceInstall).toBe(24);
  });
});


describe('launch attribution bucketing', () => {
  // These exist so `nimbalyst_session_start` can answer "did that release
  // help?" and "did they come back on day two?" without carrying a precise
  // install timestamp, which on a small cohort narrows toward one install.
  it.each([
    [0, '0'],
    [1, '1'],
    [2, '2-7'],
    [7, '2-7'],
    [8, '8-30'],
    [30, '8-30'],
    [31, '31-90'],
    [90, '31-90'],
    [91, '90+'],
  ] as const)('buckets %i days since install as %s', (days, expected) => {
    expect(bucketDaysSinceInstall(days)).toBe(expected);
  });

  // Launch two is its own bucket on purpose: "launched once and never came
  // back" is the single most important cut in the activation funnel, and it is
  // invisible if launches 2 and 3 are pooled.
  it.each([
    [1, '1'],
    [2, '2'],
    [3, '3-5'],
    [5, '3-5'],
    [6, '6-20'],
    [20, '6-20'],
    [21, '20+'],
  ] as const)('buckets launch %i as %s', (launch, expected) => {
    expect(bucketLaunchNumber(launch)).toBe(expected);
  });

  it('treats a zero or negative launch count as the first launch', () => {
    expect(bucketLaunchNumber(0)).toBe('1');
  });
});
