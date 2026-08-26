/**
 * Lexicographic fractional indexing for manual ordering.
 *
 * Generates string keys that sort lexicographically between any two existing keys.
 * Used by the tracker kanban board for drag-to-reorder.
 *
 * Based on the algorithm from https://observablehq.com/@dgreensp/implementing-fractional-indexing
 */
/**
 * Generate a sort key between `a` and `b`.
 * - `generateKeyBetween(null, null)` -> initial key (e.g. "a0")
 * - `generateKeyBetween(null, first)` -> key before `first`
 * - `generateKeyBetween(last, null)` -> key after `last`
 * - `generateKeyBetween(a, b)` -> key between `a` and `b`
 */
export declare function generateKeyBetween(a: string | null, b: string | null): string;
/**
 * Generate `n` evenly-spaced keys between `a` and `b`.
 */
export declare function generateNKeysBetween(a: string | null, b: string | null, n: number): string[];
