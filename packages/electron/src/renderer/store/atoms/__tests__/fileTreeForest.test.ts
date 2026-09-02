// @vitest-environment node
/**
 * The explorer forest is what makes a multi-root workspace visible, and its
 * hardest requirement is a negative one: a single-folder workspace must render
 * byte-identically to before, with no root header row. These cases pin that
 * boundary plus the per-root replacement the watcher depends on.
 */
import { describe, expect, it } from 'vitest';
import {
  buildFileTreeForest,
  flattenTree,
  replaceFolderChildren,
  type RendererFileTreeItem,
} from '../fileTree';

const primaryItems: RendererFileTreeItem[] = [
  { name: 'src', path: '/proj/src', type: 'directory', children: [
    { name: 'index.ts', path: '/proj/src/index.ts', type: 'file' },
  ] },
];
const attachedItems: RendererFileTreeItem[] = [
  { name: 'main.tf', path: '/infra/main.tf', type: 'file' },
];

function flatten(items: RendererFileTreeItem[], roots: string[], expanded: string[] = []) {
  return flattenTree({
    items,
    expanded: new Set(expanded),
    activeFile: null,
    selectedFolder: null,
    selectedPaths: new Set(),
    dragState: null,
    workspaceRootPaths: new Set(roots),
  });
}

describe('file tree forest', () => {
  it('returns the primary root contents unwrapped for a single-folder workspace', () => {
    expect(buildFileTreeForest(['/proj'], { '/proj': primaryItems })).toEqual(primaryItems);
  });

  it('wraps each root in a synthetic node once a folder is attached', () => {
    const forest = buildFileTreeForest(['/proj', '/infra'], {
      '/proj': primaryItems,
      '/infra': attachedItems,
    });

    expect(forest.map((node) => [node.name, node.path])).toEqual([
      ['proj', '/proj'],
      ['infra', '/infra'],
    ]);
    expect(forest[1].children).toEqual(attachedItems);
  });

  it('shows an attached root that has not finished scanning as an empty folder', () => {
    // Otherwise the folder the user just attached is simply absent until its
    // first scan lands, which reads as "the attach failed".
    const forest = buildFileTreeForest(['/proj', '/infra'], { '/proj': primaryItems });

    expect(forest[1]).toMatchObject({ path: '/infra', type: 'directory', children: [] });
  });

  it('marks no row as a workspace root when there is only one root', () => {
    const nodes = flatten(primaryItems, ['/proj']);

    expect(nodes.some((node) => node.isWorkspaceRoot)).toBe(false);
  });

  it('marks only the top-level root nodes once folders are attached', () => {
    const forest = buildFileTreeForest(['/proj', '/infra'], {
      '/proj': primaryItems,
      '/infra': attachedItems,
    });
    const nodes = flatten(forest, ['/proj', '/infra'], ['/proj']);

    const roots = nodes.filter((node) => node.isWorkspaceRoot).map((node) => node.path);
    expect(roots).toEqual(['/proj', '/infra']);
    // A nested directory that happens to sit at depth > 0 is never a root row.
    expect(nodes.find((node) => node.path === '/proj/src')?.isWorkspaceRoot).toBe(false);
  });

  it('replaces one root subtree without disturbing its siblings', () => {
    const forest = buildFileTreeForest(['/proj', '/infra'], {
      '/proj': primaryItems,
      '/infra': attachedItems,
    });

    const [next, changed] = replaceFolderChildren(forest, '/proj/src', [
      { name: 'app.ts', path: '/proj/src/app.ts', type: 'file' },
    ]);

    expect(changed).toBe(true);
    expect(next[0].children?.[0].children).toEqual([
      { name: 'app.ts', path: '/proj/src/app.ts', type: 'file' },
    ]);
    // Structural sharing: the untouched attached root is the same object.
    expect(next[1]).toBe(forest[1]);
  });
});
