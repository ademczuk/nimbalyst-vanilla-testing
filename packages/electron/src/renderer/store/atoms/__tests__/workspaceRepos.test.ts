// @vitest-environment node
/**
 * Repo attribution in the renderer. Everything downstream -- the title-bar
 * branch indicator, the Git panel's repo picker, grouped change lists -- keys
 * off these two answers, and the hard requirement is the negative one: a
 * single-repo workspace must resolve exactly as it did before multi-root.
 */
import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import {
  groupPathsByRepo,
  repoLabels,
  resolveRepoForPath,
} from '../../../utils/workspaceRepos';
import { activeFileRepoPathAtom, workspaceRepoPathsAtom } from '../workspaceRepos';
import { activeTabIdAtom } from '@nimbalyst/runtime/store';

const REPOS = ['/proj', '/other/collab'];

describe('resolveRepoForPath', () => {
  it('attributes a file to the repo containing it', () => {
    expect(resolveRepoForPath(REPOS, '/proj/src/index.ts')).toBe('/proj');
    expect(resolveRepoForPath(REPOS, '/other/collab/src/index.ts')).toBe('/other/collab');
  });

  it('returns null for a file in no repo, rather than guessing the first', () => {
    expect(resolveRepoForPath(REPOS, '/elsewhere/a.ts')).toBeNull();
    expect(resolveRepoForPath([], '/proj/a.ts')).toBeNull();
  });

  it('prefers the deepest repo when one is checked out inside another', () => {
    expect(resolveRepoForPath(['/proj', '/proj/vendor/lib'], '/proj/vendor/lib/a.ts'))
      .toBe('/proj/vendor/lib');
  });

  it('does not match a sibling that shares a path prefix', () => {
    expect(resolveRepoForPath(['/proj'], '/proj2/a.ts')).toBeNull();
  });
});

describe('repoLabels', () => {
  it('uses bare folder names when they are unambiguous', () => {
    expect(repoLabels(REPOS)).toEqual({ '/proj': 'proj', '/other/collab': 'collab' });
  });

  it('disambiguates only the colliding entries with a parent segment', () => {
    expect(repoLabels(['/app/api', '/infra/api', '/proj'])).toEqual({
      '/app/api': 'app/api',
      '/infra/api': 'infra/api',
      '/proj': 'proj',
    });
  });
});

describe('groupPathsByRepo', () => {
  it('returns one group when every path is in one repo, so callers skip headers', () => {
    const groups = groupPathsByRepo(REPOS, ['/proj/a.ts', '/proj/b.ts']);
    expect(groups).toEqual([{ repoPath: '/proj', files: ['/proj/a.ts', '/proj/b.ts'] }]);
  });

  it('orders groups by repo and puts files in no repo last', () => {
    const groups = groupPathsByRepo(REPOS, [
      '/elsewhere/x.ts',
      '/other/collab/b.ts',
      '/proj/a.ts',
    ]);
    expect(groups).toEqual([
      { repoPath: '/proj', files: ['/proj/a.ts'] },
      { repoPath: '/other/collab', files: ['/other/collab/b.ts'] },
      { repoPath: null, files: ['/elsewhere/x.ts'] },
    ]);
  });
});

describe('activeFileRepoPathAtom', () => {
  const openFile = (store: ReturnType<typeof createStore>, filePath: string) => {
    store.set(activeTabIdAtom('main'), `main:${filePath}`);
  };

  it('follows the repo of the active file', () => {
    const store = createStore();
    store.set(workspaceRepoPathsAtom, REPOS);
    openFile(store, '/other/collab/src/index.ts');

    expect(store.get(activeFileRepoPathAtom)).toBe('/other/collab');
  });

  it('falls back to the first repo when the active file is in none', () => {
    const store = createStore();
    store.set(workspaceRepoPathsAtom, REPOS);
    openFile(store, '/elsewhere/a.ts');

    expect(store.get(activeFileRepoPathAtom)).toBe('/proj');
  });

  it('is null when the workspace contains no repo at all', () => {
    const store = createStore();
    store.set(workspaceRepoPathsAtom, []);

    expect(store.get(activeFileRepoPathAtom)).toBeNull();
  });
});
