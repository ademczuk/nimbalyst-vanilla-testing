// @vitest-environment node
import { describe, expect, it } from 'vitest';
// Import the pure merge module directly, not the barrel-ish `extensionInventory`
// -- that one reaches the IPC layer and the app store, costing seconds of
// module-import time for functions that touch neither.
import {
  mergeInventory,
  projectRegistryExtension,
  type InstalledExtensionInfo,
} from '../extensionInventoryMerge';
import type { RegistryExtension } from '../../ipc/ExtensionMarketplaceHandlers';

function installed(
  id: string,
  overrides: Partial<InstalledExtensionInfo> = {},
): InstalledExtensionInfo {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: '',
    isBuiltin: false,
    enabled: true,
    ...overrides,
  };
}

function registryEntry(id: string, overrides: Partial<RegistryExtension> = {}): RegistryExtension {
  return {
    id,
    name: id,
    description: `${id} description`,
    version: '1.0.0',
    author: 'Nimbalyst',
    categories: ['diagrams'],
    tags: ['tag'],
    icon: 'icon',
    screenshots: [{ src: 'https://example.test/a.png', alt: 'a' }],
    downloads: 0,
    featured: false,
    permissions: ['filesystem'],
    minimumAppVersion: '1.0.0',
    downloadUrl: 'https://example.test/dl',
    checksum: 'abc',
    repositoryUrl: '',
    changelog: 'notes',
    ...overrides,
  };
}

describe('projectRegistryExtension', () => {
  it('drops the payload a recommendation never needs', () => {
    const projected = projectRegistryExtension(registryEntry('com.nimbalyst.jupyter'));
    expect(projected).toEqual({
      id: 'com.nimbalyst.jupyter',
      name: 'com.nimbalyst.jupyter',
      description: 'com.nimbalyst.jupyter description',
      categories: ['diagrams'],
      tags: ['tag'],
    });
    // Screenshots, checksum, downloadUrl and changelog are the bulk of the
    // 37 KB registry; leaking them would crowd out the coach's actual findings.
    expect(Object.keys(projected)).toHaveLength(5);
  });
});

describe('mergeInventory', () => {
  it('never offers an installed extension as available to install', () => {
    const result = mergeInventory(
      [installed('com.nimbalyst.canvas')],
      [registryEntry('com.nimbalyst.canvas'), registryEntry('com.nimbalyst.jupyter')],
    );
    expect(result.available.map((e) => e.id)).toEqual(['com.nimbalyst.jupyter']);
    expect(result.registryAvailable).toBe(true);
  });

  it('degrades to the installed half when the registry is unreachable', () => {
    const result = mergeInventory([installed('com.nimbalyst.canvas')], null);
    expect(result.installed).toHaveLength(1);
    expect(result.available).toEqual([]);
    // The flag is what lets the caller say "could not reach the registry"
    // instead of wrongly reporting that nothing else exists.
    expect(result.registryAvailable).toBe(false);
  });

  it('keeps installed-but-disabled distinguishable from not-installed', () => {
    const result = mergeInventory(
      [installed('com.nimbalyst.canvas', { enabled: false }), installed('com.nimbalyst.git')],
      [registryEntry('com.nimbalyst.canvas'), registryEntry('com.nimbalyst.jupyter')],
    );

    const disabled = result.installed.find((e) => e.id === 'com.nimbalyst.canvas');
    expect(disabled?.enabled).toBe(false);
    // Disabled is still installed, so it must not resurface as an install
    // recommendation -- the fix there is to enable it, not to install it.
    expect(result.available.map((e) => e.id)).toEqual(['com.nimbalyst.jupyter']);
  });

  it('reports an empty registry as reachable-but-empty, not unreachable', () => {
    const result = mergeInventory([installed('com.nimbalyst.git')], []);
    expect(result.available).toEqual([]);
    expect(result.registryAvailable).toBe(true);
  });
});
