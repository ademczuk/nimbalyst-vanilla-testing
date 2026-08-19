import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  rewriteMarkdownImageRefs,
  scanCollabAssetImageRefs,
} from './markdownAssetScanner';

export interface MaterializedAsset {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

export interface MaterializeMarkdownCollabAssetsInput {
  markdown: string;
  workspacePath: string;
  sourceFilePath: string;
  documentId: string;
  readAsset(assetId: string): Promise<MaterializedAsset>;
}

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function parseAssetUri(uri: string): { documentId: string; assetId: string } | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'collab-asset:' || parsed.hostname !== 'doc') return null;
    const match = parsed.pathname.match(/^\/([^/]+)\/asset\/([^/]+)$/);
    if (!match) return null;
    return {
      documentId: decodeURIComponent(match[1]),
      assetId: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function chooseExtension(asset: MaterializedAsset): string {
  const mimeExtension = EXTENSION_BY_MIME[asset.mimeType.toLowerCase()];
  if (mimeExtension) return mimeExtension;
  const fileExtension = path.extname(asset.fileName).slice(1).toLowerCase();
  if (ALLOWED_EXTENSIONS.has(fileExtension)) return fileExtension;
  throw new Error(`Unsupported shared image type '${asset.mimeType || fileExtension || 'unknown'}'.`);
}

async function writeContentAddressedAsset(
  workspacePath: string,
  asset: MaterializedAsset,
): Promise<string> {
  const hash = createHash('sha256').update(asset.bytes).digest('hex');
  const extension = chooseExtension(asset);
  const assetDirectory = path.join(workspacePath, '.nimbalyst', 'assets');
  const assetPath = path.join(assetDirectory, `${hash}.${extension}`);
  await fs.mkdir(assetDirectory, { recursive: true });
  try {
    await fs.writeFile(assetPath, asset.bytes, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await fs.readFile(assetPath);
    if (createHash('sha256').update(existing).digest('hex') !== hash) {
      throw new Error(`Existing local asset '${path.basename(assetPath)}' has unexpected content.`);
    }
  }
  return assetPath;
}

export async function materializeMarkdownCollabAssets(
  input: MaterializeMarkdownCollabAssetsInput,
): Promise<{ markdown: string; materializedCount: number }> {
  const refs = scanCollabAssetImageRefs(input.markdown);
  if (refs.length === 0) {
    return { markdown: input.markdown, materializedCount: 0 };
  }

  const substitutions = new Map<string, string>();
  for (const ref of refs) {
    const parsed = parseAssetUri(ref);
    if (!parsed) throw new Error(`Invalid shared image reference '${ref}'.`);
    if (parsed.documentId !== input.documentId) {
      throw new Error('A shared image reference does not belong to this shared document.');
    }

    const asset = await input.readAsset(parsed.assetId);
    const assetPath = await writeContentAddressedAsset(input.workspacePath, asset);
    const relativePath = path
      .relative(path.dirname(input.sourceFilePath), assetPath)
      .split(path.sep)
      .join('/');
    substitutions.set(ref, relativePath);
  }

  return {
    markdown: rewriteMarkdownImageRefs(input.markdown, substitutions),
    materializedCount: substitutions.size,
  };
}
