/**
 * Service for loading custom tracker definitions from workspace .nimbalyst/trackers directory
 */

import { logger } from '../utils/logger';

const log = logger.general;

/**
 * Loads custom tracker YAML definitions from the workspace's .nimbalyst/trackers directory
 * @param workspacePath - Path to the workspace root
 */
export async function loadCustomTrackers(workspacePath: string): Promise<void> {
  if (!workspacePath || !window.electronAPI?.getFolderContents || !window.electronAPI?.readFileContent) {
    return;
  }

  try {
    // Deep path, not the `@nimbalyst/runtime` barrel: the barrel drags in the
    // whole Lexical editor tree for three functions.
    const { globalRegistry, isTrackerPatchFileName, resolveTrackerSchemaFileContent } =
      await import('@nimbalyst/runtime/plugins/TrackerPlugin/models');

    // Use simple path joining (works in browser)
    const trackersDir = `${workspacePath}/.nimbalyst/trackers`;

    let files: Awaited<ReturnType<typeof window.electronAPI.getFolderContents>>;
    try {
      files = await window.electronAPI.getFolderContents(trackersDir);
    } catch (error) {
      log.info('[CustomTrackers] Could not scan directory:', error);
      return;
    }

    // Full schemas before patches: a patch resolves against its seed, so a
    // custom type's own `<type>.yaml` has to be registered first.
    const yamlFiles = files
      .filter(f => f.type === 'file' && (f.name.endsWith('.yaml') || f.name.endsWith('.yml')))
      .sort((a, b) => Number(isTrackerPatchFileName(a.name)) - Number(isTrackerPatchFileName(b.name)));

    for (const file of yamlFiles) {
      try {
        const result = await window.electronAPI.readFileContent(`${trackersDir}/${file.name}`);
        if (!result?.success || !result.content) continue;
        // `<type>.patch.yaml` has no `displayName` by design. Running the
        // full-model parser over one threw on every workspace load and dropped
        // the override silently (NIM-3065).
        globalRegistry.register(resolveTrackerSchemaFileContent(file.name, result.content));
      } catch (error) {
        log.error(`[CustomTrackers] Failed to load ${file.name}:`, error);
      }
    }
  } catch (error) {
    log.error('[CustomTrackers] Failed to load custom trackers:', error);
  }
}
