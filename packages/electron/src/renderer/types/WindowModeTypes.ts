/**
 * Window Mode System Types
 *
 * Defines content modes available in workspace windows.
 * Each component manages its own state - this just tracks which mode is active.
 */

/**
 * Content modes available in workspace windows
 * - files: File tree and editor tabs
 * - agent: Agentic coding panel
 * - tracker: Tracker (bug/decision) items view
 * - collab: Shared documents
 * - org: The project organization's inbox, rooms and direct messages
 * - pr-review: GitHub pull request review panel (issue #307)
 * - settings: Settings view
 *
 * The standalone organization window (?mode=team-management) still exists as
 * the cross-org surface; `org` is the project's own organization, hosted here.
 */
export type ContentMode = 'files' | 'agent' | 'tracker' | 'collab' | 'org' | 'pr-review' | 'settings';
