// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('child_process')>(),
  execFile: childProcessMocks.execFile,
}));

import { CursorAgentProvider } from '../CursorAgentProvider';
import { GrokBuildProvider } from '../GrokBuildProvider';

afterEach(() => {
  childProcessMocks.execFile.mockReset();
  CursorAgentProvider.setCursorPathLoader(null);
  GrokBuildProvider.setGrokPathLoader(null);
});

describe('headless CLI model catalogs', () => {
  it('discovers Grok models without synchronously blocking the caller', async () => {
    childProcessMocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      queueMicrotask(() => callback(null, 'Available models:\n  * grok-4.6 (default)\n  - grok-4.5\n', ''));
    });

    await expect(GrokBuildProvider.getModels()).resolves.toEqual([
      { id: 'grok-build:grok-4.6', name: 'grok-4.6', provider: 'grok-build' },
      { id: 'grok-build:grok-4.5', name: 'grok-4.5', provider: 'grok-build' },
    ]);
    expect(childProcessMocks.execFile).toHaveBeenCalledWith(
      'grok',
      ['models'],
      expect.objectContaining({ encoding: 'utf8', timeout: 10_000 }),
      expect.any(Function),
    );
  });

  it('discovers Cursor models without synchronously blocking the caller', async () => {
    childProcessMocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      queueMicrotask(() => callback(
        null,
        'Available models\n\nauto - Auto (current, default)\ngpt-5.3-codex - Codex 5.3\n',
        '',
      ));
    });

    await expect(CursorAgentProvider.getModels()).resolves.toEqual([
      { id: 'cursor-agent:auto', name: 'Auto', provider: 'cursor-agent' },
      { id: 'cursor-agent:gpt-5.3-codex', name: 'Codex 5.3', provider: 'cursor-agent' },
    ]);
    expect(childProcessMocks.execFile).toHaveBeenCalledWith(
      'cursor-agent',
      ['--list-models'],
      expect.objectContaining({ encoding: 'utf8', timeout: 15_000 }),
      expect.any(Function),
    );
  });
});
