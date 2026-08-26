/**
 * Model loader for built-in and custom tracker definitions
 */

import { parseTrackerYAML } from './YAMLParser';
import { globalRegistry, type TrackerDataModel } from './TrackerDataModel';
import { parseTrackerSchemaPatchYAML, resolveTrackerSchemaPatch } from './schemaPatch';

// Built-in tracker definitions are authored as YAML under ./builtins and bundled
// as raw strings via Vite's `?raw` loader (see runtime/src/env.d.ts). This is the
// single source of truth for builtins and the resolvable seed that workspace and
// synced overrides (patches) layer onto. Both the Electron renderer/main and the
// mobile Capacitor build compile runtime source through Vite, which inlines these
// strings at build time, so no separate asset copy is needed.
import planYaml from './builtins/plan.yaml?raw';
import decisionYaml from './builtins/decision.yaml?raw';
import bugYaml from './builtins/bug.yaml?raw';
import taskYaml from './builtins/task.yaml?raw';
import ideaYaml from './builtins/idea.yaml?raw';
import milestoneYaml from './builtins/milestone.yaml?raw';
import releaseYaml from './builtins/release.yaml?raw';
// import featureYaml from './builtins/feature.yaml?raw';
// import automationYaml from './builtins/automation.yaml?raw';

/**
 * Raw YAML strings for every bundled builtin tracker type, in load order.
 * Keep this list in sync with the files under ./builtins.
 */
export const BUILTIN_TRACKER_YAML: ReadonlyArray<{ type: string; yaml: string }> = [
  { type: 'plan', yaml: planYaml },
  { type: 'decision', yaml: decisionYaml },
  { type: 'bug', yaml: bugYaml },
  { type: 'task', yaml: taskYaml },
  { type: 'idea', yaml: ideaYaml },
  { type: 'milestone', yaml: milestoneYaml },
  { type: 'release', yaml: releaseYaml },
  // { type: 'feature', yaml: featureYaml },
  // { type: 'automation', yaml: automationYaml },
];

/**
 * Parse every bundled builtin YAML into resolved models. Throws if any builtin
 * YAML is malformed or its declared `type` doesn't match its filename, so a bad
 * builtin fails fast (in CI and at startup) instead of silently dropping a type.
 */
export function parseBuiltinTrackers(): TrackerDataModel[] {
  return BUILTIN_TRACKER_YAML.map(({ type, yaml }) => {
    const model = parseTrackerYAML(yaml);
    if (model.type !== type) {
      throw new Error(
        `Builtin tracker YAML for '${type}' declares mismatched type '${model.type}'`
      );
    }
    return model;
  });
}


/**
 * True for the `<type>.patch.yaml` shape, which carries only a delta from a
 * builtin seed and legitimately has no `displayName`.
 */
export function isTrackerPatchFileName(fileName: string): boolean {
  return /\.patch\.ya?ml$/i.test(fileName);
}

/**
 * Resolve a workspace schema file's content to a fully-resolved model,
 * whichever of the two on-disk shapes it is.
 *
 * Every reader of `.nimbalyst/trackers/*.yaml` must go through this. Running
 * the full-model parser over a patch throws `Missing required field:
 * displayName` — which is how the renderer silently dropped every builtin
 * override on each workspace load, and how the Settings "Edit schema override"
 * button silently did nothing (NIM-3065).
 *
 * Throws on a patch whose target type has no seed, so a stray patch surfaces
 * instead of registering a broken model.
 */
export function resolveTrackerSchemaFileContent(
  fileName: string,
  content: string,
): TrackerDataModel {
  if (!isTrackerPatchFileName(fileName)) return parseTrackerYAML(content);
  const patch = parseTrackerSchemaPatchYAML(content);
  const seed = globalRegistry.getBuiltinModel(patch.type) ?? globalRegistry.get(patch.type);
  if (!seed) throw new Error(`Tracker schema patch targets unknown type '${patch.type}'`);
  return resolveTrackerSchemaPatch(seed, patch);
}

/**
 * Load all built-in tracker definitions
 */
export function loadBuiltinTrackers(): void {
  // console.log('[TrackerPlugin] Loading built-in trackers...');

  for (const { type, yaml } of BUILTIN_TRACKER_YAML) {
    try {
      const model = parseTrackerYAML(yaml);
      if (model.type !== type) {
        throw new Error(`declares mismatched type '${model.type}'`);
      }
      globalRegistry.register(model, true);
      // console.log(`[TrackerPlugin] Loaded built-in tracker: ${model.type}`);
    } catch (error) {
      console.error(`[TrackerPlugin] Failed to load built-in tracker '${type}':`, error);
    }
  }

  console.log(`[TrackerPlugin] Loaded ${globalRegistry.getAll().length} built-in trackers`);
}

/**
 * Load a custom tracker definition from YAML string
 */
export function loadCustomTracker(yamlString: string): void {
  const model = parseTrackerYAML(yamlString);
  globalRegistry.register(model);
  console.log(`[TrackerPlugin] Loaded custom tracker: ${model.type}`);
}

/**
 * Load custom trackers from a directory (for workspace-specific trackers)
 * This would be called by the Electron main process and passed to the renderer
 */
export async function loadCustomTrackersFromDirectory(
  directoryPath: string,
  fs: any // File system interface
): Promise<void> {
  // This function would be implemented in the Electron layer
  // to read YAML files from .nimbalyst/trackers/ directory
  console.log(`[TrackerPlugin] Loading custom trackers from: ${directoryPath}`);
}

/**
 * ModelLoader singleton for accessing tracker models
 */
export class ModelLoader {
  private static instance: ModelLoader;

  private constructor() {
    // Initialize built-in trackers on construction
    loadBuiltinTrackers();
  }

  static getInstance(): ModelLoader {
    if (!ModelLoader.instance) {
      ModelLoader.instance = new ModelLoader();
    }
    return ModelLoader.instance;
  }

  async getModel(type: string): Promise<TrackerDataModel> {
    const model = globalRegistry.get(type);
    if (!model) {
      throw new Error(`Tracker model not found for type: ${type}`);
    }
    return model;
  }

  getAllModels(): TrackerDataModel[] {
    return globalRegistry.getAll();
  }
}
