/**
 * extensionInventory -- "what extensions does this install have, and what else
 * exists" for the `extensions_list` MCP tool.
 *
 * Settings' `settings_get_overview` deliberately does not carry this: it is a
 * settings snapshot, and the extension set is neither a setting nor small. The
 * coach command (`/planning:nimbalyst-coach`) needs it to answer "you have 43 .ipynb
 * files and no notebook editor installed", which requires knowing the installed
 * set, the enabled set, and the available set as three distinct things.
 *
 * Installed-but-disabled is the case that makes a naive directory listing wrong:
 * the directory is present, the extension does nothing, and recommending an
 * install would be noise while recommending an enable is the actual fix.
 *
 * The scan mirrors `listExtensionBackendModules` in ExtensionHandlers (user
 * directory first, then built-in, first id wins). The registry half reuses the
 * marketplace's own `fetchRegistry`, so there is exactly one registry URL and
 * one cache in the process.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { getAllExtensionDirectories } from '../ipc/ExtensionHandlers';
import { fetchRegistry, type RegistryExtension } from '../ipc/ExtensionMarketplaceHandlers';
import { getExtensionEnabled } from '../utils/store';
import { logger } from '../utils/logger';
import { mergeInventory, type ExtensionInventory, type InstalledExtensionInfo } from './extensionInventoryMerge';

export type {
  AvailableExtensionInfo,
  ExtensionInventory,
  InstalledExtensionInfo,
} from './extensionInventoryMerge';
export { mergeInventory, projectRegistryExtension } from './extensionInventoryMerge';

/** Scan the user and built-in extension directories for installed manifests. */
export async function scanInstalledExtensions(): Promise<InstalledExtensionInfo[]> {
  const out: InstalledExtensionInfo[] = [];
  const seen = new Set<string>();
  const dirs = await getAllExtensionDirectories();

  for (let i = 0; i < dirs.length; i++) {
    const extensionsDir = dirs[i];
    const isBuiltinDir = i > 0; // First directory is user extensions.

    let subdirs;
    try {
      subdirs = await fs.readdir(extensionsDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const subdir of subdirs) {
      let isDir = subdir.isDirectory();
      if (!isDir && subdir.isSymbolicLink()) {
        try {
          isDir = (await fs.stat(path.join(extensionsDir, subdir.name))).isDirectory();
        } catch {
          continue;
        }
      }
      if (!isDir) continue;

      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(extensionsDir, subdir.name, 'manifest.json'), 'utf-8'),
        ) as {
          id?: string;
          name?: string;
          version?: string;
          description?: string;
          contributions?: { claudePlugin?: { enabledByDefault?: boolean } };
        };

        const id = manifest.id || subdir.name;
        if (seen.has(id)) continue;
        seen.add(id);

        out.push({
          id,
          name: manifest.name || id,
          version: manifest.version || 'unknown',
          description: manifest.description || '',
          isBuiltin: isBuiltinDir,
          enabled: getExtensionEnabled(id),
        });
      } catch {
        // Directory without a readable manifest -- not an extension.
      }
    }
  }

  return out;
}

/**
 * Build the full inventory. Never throws: a registry failure degrades to the
 * installed half with `registryAvailable: false` so the caller can say so in
 * one line instead of silently reporting "no extensions available".
 */
export async function buildExtensionInventory(): Promise<ExtensionInventory> {
  const installed = await scanInstalledExtensions();

  let registryExtensions: RegistryExtension[] | null = null;
  try {
    const registry = await fetchRegistry();
    registryExtensions = registry.extensions ?? [];
  } catch (error) {
    logger.main.warn('[extensionInventory] Registry unavailable, returning installed only:', error);
  }

  return mergeInventory(installed, registryExtensions);
}
