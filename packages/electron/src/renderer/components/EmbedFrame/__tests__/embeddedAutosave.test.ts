// @vitest-environment node
/**
 * The parts of embedded autosave that only fail under conditions a reader
 * cannot produce on screen: a save that is already in flight, a write that
 * keeps failing, and an exit path arriving mid-backoff.
 *
 * The last one is the reason this module exists. A card cooling out of hot, or
 * a board closing, is the final chance a debounced edit gets -- honouring a
 * thirty-second backoff there means the bytes are simply gone.
 */
import { describe, expect, it, vi } from 'vitest';

import { createEmbeddedAutosaveController } from '../embeddedAutosave';

function controller(
  save: () => Promise<void>,
  options: { dirty?: () => boolean; now?: () => number } = {},
) {
  const blocked: (string | null)[] = [];
  const instance = createEmbeddedAutosaveController({
    label: '[test]',
    save,
    isDirty: options.dirty ?? (() => true),
    now: options.now,
    onBlockedChange: (errorType) => blocked.push(errorType),
    retryDelaysMs: [100],
  });
  return { instance, blocked };
}

describe('embedded autosave', () => {
  it('does not start a second save while one is in flight', async () => {
    let release = () => {};
    const save = vi.fn(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const { instance } = controller(save);

    const first = instance.tick();
    void instance.tick();
    expect(save).toHaveBeenCalledTimes(1);

    release();
    await first;

    save.mockResolvedValue(undefined);
    await instance.tick();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('backs off, then gives up with the error type the strip renders', async () => {
    let clock = 0;
    const save = vi.fn().mockRejectedValue(
      Object.assign(new Error('nope'), { errorType: 'permission-denied' }),
    );
    const { instance, blocked } = controller(save, { now: () => clock });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await instance.tick();
    // Inside the backoff window the timer is a no-op, rather than hammering a
    // failing write every two seconds.
    await instance.tick();
    expect(save).toHaveBeenCalledTimes(1);

    clock = 200;
    await instance.tick();
    expect(save).toHaveBeenCalledTimes(2);
    expect(blocked).toEqual(['permission-denied']);

    // Latched: a blocked controller stops trying until someone asks it to.
    clock = 1000;
    await instance.tick();
    expect(save).toHaveBeenCalledTimes(2);

    save.mockResolvedValue(undefined);
    await instance.retry();
    expect(save).toHaveBeenCalledTimes(3);
    expect(blocked).toEqual(['permission-denied', null]);
  });

  it('flushes through a backoff, because an exit path has no later', async () => {
    let clock = 0;
    const save = vi.fn().mockRejectedValueOnce(new Error('transient'));
    const { instance } = controller(save, { now: () => clock });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await instance.tick();
    expect(save).toHaveBeenCalledTimes(1);

    // Same instant, still well inside the 100ms backoff a `tick` would obey.
    save.mockResolvedValue(undefined);
    await instance.flush('cooled');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('reports flushing only for the duration of a flush', async () => {
    const seen: boolean[] = [];
    const { instance } = controller(async () => {
      seen.push(instance.isFlushing());
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await instance.tick();
    await instance.flush('unmounted');
    // The read-only guard keys off this: a timer tick must not be waved
    // through, only the deliberate exit-path write.
    expect(seen).toEqual([false, true]);
    expect(instance.isFlushing()).toBe(false);
  });

  it('writes nothing for a clean editor', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { instance } = controller(save, { dirty: () => false });

    await instance.tick();
    await instance.flush('unmounted');
    expect(save).not.toHaveBeenCalled();
  });
});
