// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createConsoleStallGuard } from '../consoleStallGuard';

/**
 * A fake clock that the writes themselves advance, so a "slow terminal" is
 * modelled without real timers.
 */
function harness(writeCostMs: () => number) {
  let clock = 0;
  const written: string[] = [];
  const emit = (line: string) => {
    written.push(line);
    clock += writeCostMs();
  };
  const guard = createConsoleStallGuard({
    writeNotice: emit,
    stallThresholdMs: 250,
    cooldownMs: 5000,
    now: () => clock,
  });
  return {
    written,
    write: (line: string) => guard.run(() => emit(line)),
    stats: guard.stats,
    tick: (ms: number) => { clock += ms; },
  };
}

describe('createConsoleStallGuard', () => {
  it('suppresses terminal writes after a stalled one, then resumes with a dropped count', () => {
    let cost = 12_638; // the stall measured on 2026-08-27
    const h = harness(() => cost);

    h.write('first');
    cost = 0;

    // Everything the cascade wants to log during the cooldown is dropped.
    for (let i = 0; i < 60; i++) h.write(`cascade ${i}`);
    expect(h.written).toEqual(['first']);
    expect(h.stats()).toMatchObject({ suppressedWrites: 60, stallEvents: 1 });

    // After the cooldown, output resumes and accounts for the gap.
    h.tick(5001);
    h.write('after');
    expect(h.written).toEqual([
      'first',
      '[log] terminal stalled for 12638ms; dropped 60 console lines (main.log is unaffected)',
      'after',
    ]);
    expect(h.stats().suppressedWrites).toBe(0);
  });

  it('re-enters the cooldown when the recovery notice itself stalls', () => {
    const h = harness(() => 400);

    h.write('first');           // stalls, opens the cooldown
    h.write('dropped');         // suppressed
    h.tick(5001);
    h.write('should not print'); // notice stalls again, so this is skipped too

    expect(h.written).toEqual([
      'first',
      '[log] terminal stalled for 400ms; dropped 1 console lines (main.log is unaffected)',
    ]);
    expect(h.stats().stallEvents).toBe(2);
  });

  it('never suppresses when the terminal keeps up', () => {
    const h = harness(() => 1);
    for (let i = 0; i < 100; i++) h.write(`line ${i}`);
    expect(h.written).toHaveLength(100);
    expect(h.stats().stallEvents).toBe(0);
  });
});
