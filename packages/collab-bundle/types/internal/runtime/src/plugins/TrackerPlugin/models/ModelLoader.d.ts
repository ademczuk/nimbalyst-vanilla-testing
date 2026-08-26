/**
 * Model loader for built-in and custom tracker definitions
 */
import { type TrackerDataModel } from './TrackerDataModel';
/**
 * Raw YAML strings for every bundled builtin tracker type, in load order.
 * Keep this list in sync with the files under ./builtins.
 */
export declare const BUILTIN_TRACKER_YAML: ReadonlyArray<{
    type: string;
    yaml: string;
}>;
/**
 * Parse every bundled builtin YAML into resolved models. Throws if any builtin
 * YAML is malformed or its declared `type` doesn't match its filename, so a bad
 * builtin fails fast (in CI and at startup) instead of silently dropping a type.
 */
export declare function parseBuiltinTrackers(): TrackerDataModel[];
/**
 * True for the `<type>.patch.yaml` shape, which carries only a delta from a
 * builtin seed and legitimately has no `displayName`.
 */
export declare function isTrackerPatchFileName(fileName: string): boolean;
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
export declare function resolveTrackerSchemaFileContent(fileName: string, content: string): TrackerDataModel;
/**
 * Load all built-in tracker definitions
 */
export declare function loadBuiltinTrackers(): void;
/**
 * Load a custom tracker definition from YAML string
 */
export declare function loadCustomTracker(yamlString: string): void;
/**
 * Load custom trackers from a directory (for workspace-specific trackers)
 * This would be called by the Electron main process and passed to the renderer
 */
export declare function loadCustomTrackersFromDirectory(directoryPath: string, fs: any): Promise<void>;
/**
 * ModelLoader singleton for accessing tracker models
 */
export declare class ModelLoader {
    private static instance;
    private constructor();
    static getInstance(): ModelLoader;
    getModel(type: string): Promise<TrackerDataModel>;
    getAllModels(): TrackerDataModel[];
}
