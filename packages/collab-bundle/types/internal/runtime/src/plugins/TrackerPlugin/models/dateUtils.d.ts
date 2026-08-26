/**
 * Date parsing utility for tracker frontmatter values.
 *
 * Handles the variety of formats that appear in YAML frontmatter:
 * - Date objects (YAML parser auto-converts bare dates like `date: 2025-08-25`)
 * - Numbers (timestamps)
 * - ISO strings: 2025-08-25, 2025-08-25T12:00:00Z
 * - US format: 08/25/2025, 8/25/2025
 * - Written: Aug 25, 2025 / August 25, 2025 / 25 Aug 2025
 *
 * Returns null if the value cannot be parsed as a date.
 */
/**
 * Format a Date as a local-timezone date-only string (YYYY-MM-DD).
 * Use this whenever writing dates to frontmatter so they round-trip correctly
 * through parseDate (which treats date-only strings as local midnight).
 */
export declare function formatLocalDateOnly(d: Date): string;
/**
 * True when a stored value names a calendar day rather than an instant.
 *
 * A schema `date` field stores `YYYY-MM-DD`; AI tools sometimes emit the
 * `T00:00:00Z` form meaning the same thing. Display code needs this to know
 * whether to reason in calendar days or in elapsed time.
 */
export declare function isDateOnlyValue(value: unknown): boolean;
export declare function parseDate(value: unknown): Date | null;
