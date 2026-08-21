/**
 * VENDORED COPY of the issue-key vocabulary from
 * `packages/runtime/src/plugins/TrackerPlugin/models/localIssueKey.ts` and the
 * message constants from `.../models/trackerLifecycle.ts`.
 *
 * Vendored for the same reason as `trackerRecord.ts`: the runtime package is
 * built with Vite into bundle chunks, so a Node-ESM `import` from the published
 * package does not resolve. The logic here is pure.
 *
 * KEEP IN SYNC with those two runtime modules. Drift here is not cosmetic --
 * the CLI and the app previously disagreed about what a numbered item *is*, and
 * the CLI reported `unassigned` for items the app displayed as `NIM.75`
 * (#1346).
 */

/** `NIM.75` -- this machine's private number for an item in one project. */
const LOCAL_KEY_PATTERN = /^([A-Z]{2,5})\.(\d+)$/;

/** `LC-2` -- the retired provisional form, still present in old databases. */
const LEGACY_LOCAL_ISSUE_KEY_PATTERN = /^LC-\d+$/;

export function isLocalKeyReference(reference: string | null | undefined): boolean {
  return typeof reference === 'string' && LOCAL_KEY_PATTERN.test(reference.trim());
}

/**
 * Legacy `LC-###` values were reissued as items were acked, so one never
 * identifies a particular item for long. They are stored but never displayed
 * and never resolved.
 */
export function isLegacyLocalIssueKey(reference: string | null | undefined): boolean {
  return typeof reference === 'string' && LEGACY_LOCAL_ISSUE_KEY_PATTERN.test(reference.trim());
}

/**
 * The key to show for an item: the room's key first, because it is the only
 * form that means the same thing to everyone, then this machine's number.
 */
export function resolveDisplayIssueKey(
  item: { issueKey?: string | null; localKey?: string | null },
): string | undefined {
  if (item.issueKey && !isLegacyLocalIssueKey(item.issueKey)) return item.issueKey;
  return item.localKey ?? undefined;
}

export const TRACKER_UNASSIGNED_ISSUE_KEY_MESSAGE = 'This item has no key until it is published.';

export const TRACKER_LOCAL_ISSUE_KEY_MESSAGE =
  'This number is private to this project on this machine. It is not a shared key — '
  + 'do not use it in commit messages or anywhere another person will read it.';

export const TRACKER_NO_TEAM_ISSUE_KEY_MESSAGE =
  'This workspace has no team, so no shared issue key can be issued — publishing will not produce one.';
