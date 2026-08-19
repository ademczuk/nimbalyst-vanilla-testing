// @vitest-environment node

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { materializeMarkdownCollabAssets } from '../CollabMarkdownAssetMaterializer';

const temporaryDirectories: string[] = [];

async function createWorkspace(): Promise<string> {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'nim-pull-assets-'));
  temporaryDirectories.push(workspacePath);
  await fs.mkdir(path.join(workspacePath, 'docs'), { recursive: true });
  return workspacePath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) =>
    fs.rm(dir, { recursive: true, force: true }),
  ));
});

describe('materializeMarkdownCollabAssets', () => {
  it('writes content-addressed assets and rewrites image refs relative to the document', async () => {
    const workspacePath = await createWorkspace();
    const sourceFilePath = path.join(workspacePath, 'docs', 'notes.md');
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const uri = 'collab-asset://doc/doc-1/asset/asset-a';
    const readAsset = vi.fn(async () => ({
      bytes,
      mimeType: 'image/png',
      fileName: 'photo.png',
    }));

    const result = await materializeMarkdownCollabAssets({
      markdown: `before\n![photo](${uri})\nafter`,
      workspacePath,
      sourceFilePath,
      documentId: 'doc-1',
      readAsset,
    });

    expect(result.markdown).toContain(`![photo](../.nimbalyst/assets/${hash}.png)`);
    expect(result.materializedCount).toBe(1);
    expect(await fs.readFile(path.join(workspacePath, '.nimbalyst', 'assets', `${hash}.png`)))
      .toEqual(Buffer.from(bytes));
    expect(readAsset).toHaveBeenCalledOnce();
  });

  it('downloads a repeated asset only once', async () => {
    const workspacePath = await createWorkspace();
    const uri = 'collab-asset://doc/doc-1/asset/asset-a';
    const readAsset = vi.fn(async () => ({
      bytes: new Uint8Array([9]),
      mimeType: 'image/webp',
      fileName: 'photo.webp',
    }));

    const result = await materializeMarkdownCollabAssets({
      markdown: `![one](${uri})\n![two](${uri})`,
      workspacePath,
      sourceFilePath: path.join(workspacePath, 'docs', 'notes.md'),
      documentId: 'doc-1',
      readAsset,
    });

    expect(result.materializedCount).toBe(1);
    expect(readAsset).toHaveBeenCalledOnce();
  });

  it('rejects an asset URI belonging to another shared document', async () => {
    const workspacePath = await createWorkspace();
    const readAsset = vi.fn();

    await expect(materializeMarkdownCollabAssets({
      markdown: '![bad](collab-asset://doc/doc-2/asset/asset-a)',
      workspacePath,
      sourceFilePath: path.join(workspacePath, 'docs', 'notes.md'),
      documentId: 'doc-1',
      readAsset,
    })).rejects.toThrow('does not belong to this shared document');
    expect(readAsset).not.toHaveBeenCalled();
  });

  it('fails before returning rewritten markdown when an asset cannot be read', async () => {
    const workspacePath = await createWorkspace();

    await expect(materializeMarkdownCollabAssets({
      markdown: '![missing](collab-asset://doc/doc-1/asset/asset-a)',
      workspacePath,
      sourceFilePath: path.join(workspacePath, 'docs', 'notes.md'),
      documentId: 'doc-1',
      readAsset: async () => { throw new Error('offline'); },
    })).rejects.toThrow('offline');
  });
});
