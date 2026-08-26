/**
 * Quick-open matching, as its own entry.
 *
 * Deliberately not folded into `docs-ui` or `trackers-ui`. A palette ranks
 * documents and tracker items against each other, so it belongs to neither
 * mode, and re-exporting it from `trackers-ui` would drag RevoGrid into a host
 * that only wanted a search order. Pure functions, no React, no state.
 */
export * from './internal/collab-client/src/quick-open/index';
