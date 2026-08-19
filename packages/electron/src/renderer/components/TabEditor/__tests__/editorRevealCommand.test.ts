// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_REVEAL_TTL_MS,
  hasEditorReveal,
  registerEditorRevealHandler,
  resetEditorRevealCommand,
  revealEditorPosition,
} from '../editorRevealCommand';

afterEach(() => {
  resetEditorRevealCommand();
  vi.useRealTimers();
});

describe('editorRevealCommand', () => {
  it('routes a reveal to the handler registered for the file path', () => {
    const handler = vi.fn();
    const unregister = registerEditorRevealHandler('/workspace/a.ts', handler);

    expect(revealEditorPosition('/workspace/a.ts', { line: 42 })).toBe(true);
    expect(handler).toHaveBeenCalledWith({ line: 42 });

    unregister();
  });

  // The reason this module exists: a line link usually opens a file that has no
  // tab yet, so the reveal arrives before any editor can service it.
  it('replays a reveal that arrived before the editor mounted', () => {
    const handler = vi.fn();

    expect(revealEditorPosition('/workspace/late.md', { line: 653 })).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    const unregister = registerEditorRevealHandler('/workspace/late.md', handler);

    expect(handler).toHaveBeenCalledWith({ line: 653 });
    unregister();
  });

  it('replays a pending reveal only once', () => {
    const first = vi.fn();
    const second = vi.fn();

    revealEditorPosition('/workspace/once.md', { line: 7 });
    registerEditorRevealHandler('/workspace/once.md', first)();
    registerEditorRevealHandler('/workspace/once.md', second)();

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('supersedes an earlier pending reveal for the same file', () => {
    const handler = vi.fn();

    revealEditorPosition('/workspace/b.md', { line: 10 });
    revealEditorPosition('/workspace/b.md', { line: 99 });

    registerEditorRevealHandler('/workspace/b.md', handler);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ line: 99 });
  });

  it('keeps pending reveals for different files independent', () => {
    const a = vi.fn();
    const b = vi.fn();

    revealEditorPosition('/workspace/a.md', { line: 1 });
    revealEditorPosition('/workspace/b.md', { line: 2 });

    registerEditorRevealHandler('/workspace/a.md', a);
    registerEditorRevealHandler('/workspace/b.md', b);

    expect(a).toHaveBeenCalledWith({ line: 1 });
    expect(b).toHaveBeenCalledWith({ line: 2 });
  });

  // Without expiry, a failed open leaves a request that fires against whatever
  // unrelated mount of that path happens next -- a scroll the user never asked for.
  it('drops a pending reveal that is never claimed in time', () => {
    vi.useFakeTimers();
    const handler = vi.fn();

    revealEditorPosition('/workspace/stale.md', { line: 5 });
    vi.advanceTimersByTime(PENDING_REVEAL_TTL_MS + 1);

    registerEditorRevealHandler('/workspace/stale.md', handler);

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not let a stale unregister remove a newer handler for the same file', () => {
    const stale = vi.fn();
    const current = vi.fn();
    const unregisterStale = registerEditorRevealHandler('/workspace/c.md', stale);
    const unregisterCurrent = registerEditorRevealHandler('/workspace/c.md', current);

    unregisterStale();

    expect(revealEditorPosition('/workspace/c.md', { line: 3 })).toBe(true);
    expect(current).toHaveBeenCalledWith({ line: 3 });
    expect(stale).not.toHaveBeenCalled();

    unregisterCurrent();
  });

  it('detects editors that expose their own reveal', () => {
    expect(hasEditorReveal({ revealPosition: vi.fn() })).toBe(true);
    expect(hasEditorReveal({ openFind: vi.fn() })).toBe(false);
    expect(hasEditorReveal(null)).toBe(false);
    expect(hasEditorReveal(undefined)).toBe(false);
  });
});
