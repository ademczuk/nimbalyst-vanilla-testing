/**
 * YAML parser for tracker data model definitions
 */
import type { TrackerDataModel, TrackerSharing } from './TrackerDataModel';
/** Normalize a parsed/JSON model without requiring a full YAML validation pass. */
export declare function normalizeTrackerSharingModel<T extends TrackerDataModel>(model: T, fallbackSharing?: TrackerSharing): T;
/**
 * Parse a YAML string into a TrackerDataModel
 */
export declare function parseTrackerYAML(yamlString: string): TrackerDataModel;
/**
 * Serialize a TrackerDataModel to YAML string
 */
export declare function serializeTrackerYAML(model: TrackerDataModel): string;
/**
 * Validate a YAML string without fully parsing
 */
export declare function validateTrackerYAML(yamlString: string): {
    valid: boolean;
    error?: string;
};
