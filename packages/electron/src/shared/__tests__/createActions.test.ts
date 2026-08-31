// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveCreateAction } from '../createActions';
import type { CreateActionMode } from '../createActions';

describe('resolveCreateAction', () => {
  // The whole per-mode contract in one table. The invariant that matters is
  // that a mode never resolves to a noun other than its own tree's — that is
  // the bug this design exists to fix (the bar used to make a session in Files).
  const cases: Array<[CreateActionMode, ReturnType<typeof resolveCreateAction>]> = [
    ['files', { kind: 'file', label: 'New file', destination: null }],
    ['collab', { kind: 'sharedDoc', label: 'New doc', destination: null }],
    ['agent', { kind: 'session', label: 'New session', destination: null }],
    ['tracker', { kind: 'trackerItem', label: 'New item', destination: null }],
    ['pr-review', null],
    ['org', null],
    ['settings', null],
  ];

  it.each(cases)('resolves %s', (mode, expected) => {
    expect(resolveCreateAction(mode)).toEqual(expected);
  });

  it('lands in the selected folder when the tree has one', () => {
    expect(resolveCreateAction('files', { selectedFolder: 'src/renderer', root: '/ws' })).toEqual({
      kind: 'file',
      label: 'New file',
      destination: 'src/renderer',
    });
  });

  it('falls back to the tree root when nothing is selected', () => {
    expect(resolveCreateAction('files', { selectedFolder: null, root: '/ws' })).toEqual({
      kind: 'file',
      label: 'New file',
      destination: '/ws',
    });
  });
});
