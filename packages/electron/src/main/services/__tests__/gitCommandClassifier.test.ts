import { describe, expect, it } from 'vitest';
import {
  containsDirectGitCommand,
  findDirectGitSegments,
  isReadOnlyGitCommandLine,
} from '../gitCommandClassifier';

describe('findDirectGitSegments', () => {
  it.each([
    ['git status', ['status']],
    ['/usr/bin/git fetch origin', ['fetch', 'origin']],
    ['env GIT_OPTIONAL_LOCKS=0 git status', ['status']],
    ['GIT_OPTIONAL_LOCKS=0 git status', ['status']],
    ['cd packages/electron && git diff --stat', ['diff', '--stat']],
    ['npm run build; git push origin main', ['push', 'origin', 'main']],
    ['git \\\n  log --oneline', ['log', '--oneline']],
    // A Windows path has to be quoted to survive the space, and its backslashes
    // are literal inside double quotes.
    ['"C:\\Program Files\\Git\\bin\\git.exe" status', ['status']],
  ])('detects %s', (command, args) => {
    const [segment] = findDirectGitSegments(command);
    expect(segment?.args).toEqual(args);
  });

  it.each([
    // The word appears but nothing invokes git.
    'echo git',
    'echo "git push"',
    'cat src/gitStatus.ts',
    'ls .github/workflows',
    // The script may run git internally, but the command line does not say so
    // and we will not claim knowledge we do not have.
    'npm test',
    'npm run legit',
    // Quoting keeps the separator inside the argument, so there is no git segment.
    "echo 'a && git push'",
  ])('does not detect %s', (command) => {
    expect(containsDirectGitCommand(command)).toBe(false);
  });

  it('finds every git segment in a chained command', () => {
    const segments = findDirectGitSegments('git add -A && npm test && git commit -m "wip"');

    expect(segments.map((segment) => segment.args[0])).toEqual(['add', 'commit']);
  });

  it('keeps a quoted argument intact rather than splitting it', () => {
    const [segment] = findDirectGitSegments('git commit -m "fix: a && b"');

    expect(segment.args).toEqual(['commit', '-m', 'fix: a && b']);
  });
});

// Skipping the post-operation status refresh for these keeps an agent's polling
// from re-reading status and reloading the Git panel on every command.
describe('isReadOnlyGitCommandLine', () => {
  it.each([
    'git status',
    'git status --porcelain',
    'git log --oneline -20',
    'git -C packages/electron diff --stat',
    'git --no-pager show HEAD',
    'cd packages/electron && git status',
  ])('treats %s as read-only', (command) => {
    expect(isReadOnlyGitCommandLine(command)).toBe(true);
  });

  it.each([
    // Writers, obviously.
    'git commit -m wip',
    'git push origin main',
    // Moves refs/remotes/*, which is the whole reason the refresh exists.
    'git fetch origin',
    // Read in one form, destructive in another; not worth distinguishing.
    'git branch -d feature',
    'git stash',
    // A build step can dirty the worktree even though git wrote nothing.
    'npm run build && git status',
    // Nothing to be read-only about.
    'echo hello',
  ])('does not treat %s as read-only', (command) => {
    expect(isReadOnlyGitCommandLine(command)).toBe(false);
  });
});
