import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  explainGitPushFailure,
  isDetachedHeadState,
  normalizeBranchSelection,
  normalizeCurrentBranch,
  resolveGitDiffTarget,
} from '../GitHandlers';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nim-git-handlers-test-'));
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function mkdirp(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

async function makeGitDir(target: string): Promise<void> {
  await mkdirp(path.join(target, '.git'));
  await fs.writeFile(path.join(target, '.git', 'HEAD'), 'ref: refs/heads/main\n');
}

async function makeGitFile(target: string): Promise<void> {
  await mkdirp(target);
  await fs.writeFile(path.join(target, '.git'), 'gitdir: /tmp/shared.git/worktrees/test\n');
}

describe('resolveGitDiffTarget', () => {
  it('keeps workspace-root files relative to the workspace repo', async () => {
    const workspacePath = path.join(tmpRoot, 'project');
    const filePath = path.join(workspacePath, 'src', 'index.ts');
    await makeGitDir(workspacePath);
    await mkdirp(path.dirname(filePath));
    await fs.writeFile(filePath, 'export {};\n');

    expect(resolveGitDiffTarget(workspacePath, filePath)).toEqual({
      gitWorkspacePath: workspacePath,
      gitFilePath: 'src/index.ts',
    });
  });

  it('resolves sibling worktree files to the worktree git root', async () => {
    const workspacePath = path.join(tmpRoot, 'project');
    const worktreePath = path.join(tmpRoot, 'project_worktrees', 'bright-tide');
    const filePath = path.join(worktreePath, 'packages', 'runtime', 'src', 'widget.tsx');
    await makeGitDir(workspacePath);
    await makeGitFile(worktreePath);
    await mkdirp(path.dirname(filePath));
    await fs.writeFile(filePath, 'export const widget = true;\n');

    expect(resolveGitDiffTarget(workspacePath, filePath)).toEqual({
      gitWorkspacePath: worktreePath,
      gitFilePath: 'packages/runtime/src/widget.tsx',
    });
  });
});

describe('detached HEAD helpers', () => {
  it('recognizes detached-head labels from simple-git and git', () => {
    expect(isDetachedHeadState('HEAD')).toBe(true);
    expect(isDetachedHeadState('(no branch)')).toBe(true);
    expect(isDetachedHeadState('HEAD detached at 4e7ad40')).toBe(true);
    expect(isDetachedHeadState('(HEAD detached at 4e7ad40)')).toBe(true);
    expect(isDetachedHeadState('main')).toBe(false);
  });

  it('normalizes detached current branches to HEAD', () => {
    expect(normalizeCurrentBranch('(no branch)')).toBe('HEAD');
    expect(normalizeCurrentBranch('HEAD detached at 4e7ad40')).toBe('HEAD');
    expect(normalizeCurrentBranch('feature/test')).toBe('feature/test');
  });

  it('normalizes detached branch selections before passing them to git commands', () => {
    expect(normalizeBranchSelection('(no branch)')).toBe('HEAD');
    expect(normalizeBranchSelection('HEAD')).toBe('HEAD');
    expect(normalizeBranchSelection('release/2026.05')).toBe('release/2026.05');
    expect(normalizeBranchSelection('')).toBeUndefined();
  });
});

describe('explainGitPushFailure', () => {
  const context = { remote: 'origin', branch: 'main' };

  // Verbatim `git push` output from a diverged branch.
  const FETCH_FIRST = [
    'To github.com:nimbalyst/nimbalyst.git',
    ' ! [rejected]        main -> main (fetch first)',
    "error: failed to push some refs to 'github.com:nimbalyst/nimbalyst.git'",
    'hint: Updates were rejected because the remote contains work that you do not',
    'hint: have locally. This is usually caused by another repository pushing to',
    'hint: the same ref. If you want to integrate the remote changes, use',
    "hint: 'git pull' before pushing again.",
    "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
  ].join('\n');

  it('leads with a pull-first summary when the remote has commits we lack', () => {
    const explained = explainGitPushFailure(FETCH_FIRST, context);

    expect(explained?.split('\n')[0]).toBe(
      "Push rejected: origin/main has commits you don't have locally. Pull first, then push again.",
    );
    // The raw output stays underneath — the menu tooltip shows the full text.
    expect(explained).toContain(FETCH_FIRST);
  });

  it('summarizes a non-fast-forward rejection the same way', () => {
    const raw = [
      ' ! [rejected]        main -> main (non-fast-forward)',
      "error: failed to push some refs to 'github.com:nimbalyst/nimbalyst.git'",
      'hint: Updates were rejected because the tip of your current branch is behind',
    ].join('\n');

    expect(explainGitPushFailure(raw, context)?.split('\n')[0]).toBe(
      "Push rejected: origin/main has commits you don't have locally. Pull first, then push again.",
    );
  });

  it('tells the user to fetch when --force-with-lease sees stale info', () => {
    const raw = [
      ' ! [rejected]        main -> main (stale info)',
      "error: failed to push some refs to 'github.com:nimbalyst/nimbalyst.git'",
    ].join('\n');

    expect(explainGitPushFailure(raw, context)?.split('\n')[0]).toBe(
      'Push rejected: origin/main moved since your last fetch. Pull first, then push again.',
    );
  });

  // A failing pre-push hook prints the SAME `failed to push some refs` tail as a
  // diverged push, so keying on that line alone would mislabel a red test suite
  // as "you need to pull".
  it('leaves a pre-push hook failure untouched', () => {
    const raw = [
      '[pre-push] Running non-provider unit tests...',
      ' FAIL  packages/electron/src/main/services/ai/__tests__/example.test.ts',
      "error: failed to push some refs to 'github.com:nimbalyst/nimbalyst.git'",
    ].join('\n');

    expect(explainGitPushFailure(raw, context)).toBe(raw);
  });

  it('passes through empty and missing errors', () => {
    expect(explainGitPushFailure(undefined, context)).toBeUndefined();
    expect(explainGitPushFailure('', context)).toBe('');
  });
});
