/**
 * Pure half of the extension inventory: the shapes, the registry projection,
 * and the installed/available merge.
 *
 * Split from `extensionInventory.ts` because that module reaches the IPC layer
 * and the app store to do its scan, which costs seconds of module-import time
 * in a test that only wants to check merge behavior. Everything here is pure
 * and imports nothing but types.
 */

import type { RegistryExtension } from '../ipc/ExtensionMarketplaceHandlers';

export interface InstalledExtensionInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  isBuiltin: boolean;
  enabled: boolean;
}

export interface AvailableExtensionInfo {
  id: string;
  name: string;
  description: string;
  categories: string[];
  tags: string[];
}

export interface ExtensionInventory {
  installed: InstalledExtensionInfo[];
  /** Registry entries that are not installed. Empty when the registry is unreachable. */
  available: AvailableExtensionInfo[];
  /** False when the registry could not be read; `available` is then not authoritative. */
  registryAvailable: boolean;
}

/**
 * Reduce a registry entry to the fields a recommendation needs.
 *
 * The live registry is ~37 KB, most of it screenshots, checksums, download URLs
 * and changelogs. Handing that to a model wastes the context the coach needs
 * for actual findings, so the projection happens here rather than at the call
 * site where it would be easy to forget.
 */
export function projectRegistryExtension(entry: RegistryExtension): AvailableExtensionInfo {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    categories: entry.categories ?? [],
    tags: entry.tags ?? [],
  };
}

/**
 * Merge the installed set with the registry's available set.
 *
 * An installed extension never appears as "available to install" -- including
 * when it is installed but disabled, where the fix is to enable it rather than
 * to install it again. A null registry (unreachable) degrades to the installed
 * half rather than claiming nothing else exists.
 */
export function mergeInventory(
  installed: InstalledExtensionInfo[],
  registryExtensions: RegistryExtension[] | null,
): ExtensionInventory {
  if (registryExtensions === null) {
    return { installed, available: [], registryAvailable: false };
  }

  const installedIds = new Set(installed.map((e) => e.id));
  const available = registryExtensions
    .filter((entry) => !installedIds.has(entry.id))
    .map(projectRegistryExtension);

  return { installed, available, registryAvailable: true };
}
