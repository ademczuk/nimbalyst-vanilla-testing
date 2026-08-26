/**
 * ID Generation system using ULID with type prefixes
 */
/**
 * Generate a type prefix by removing vowels and limiting to 4 characters
 * Examples:
 *   plan -> pln
 *   decision -> dcsn
 *   bug -> bug
 *   task -> tsk
 */
export declare function generatePrefix(type: string): string;
/**
 * Generate a tracker item ID with type prefix
 * Format: {prefix}_{ulid}
 * Example: pln_01HQXYZ7890ABCDEF12345
 */
export declare function generateTrackerId(type: string): string;
/**
 * Parse a tracker ID to extract type prefix and ULID
 */
export declare function parseTrackerId(id: string): {
    prefix: string;
    ulid: string;
} | null;
/**
 * Validate a tracker ID format
 */
export declare function validateTrackerId(id: string): boolean;
