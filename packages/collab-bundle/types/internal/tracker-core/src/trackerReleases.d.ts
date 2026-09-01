/**
 * Releases as tracker items.
 *
 * A release is a collection (see `trackerCollections.ts`) that exists *before*
 * it is built: created early as the "next release" bucket, items associated
 * with it as they land, and only at build time do the version, git tag, and
 * date get filled in and the status flipped. The tag is a field populated late,
 * never the identity of the item -- which is what lets the tracker and the
 * release scripts describe the same release.
 *
 * Pure and I/O-free so the `nim` CLI (which the release script calls), the MCP
 * tools, and the app all agree on which release is pending and what its notes
 * say.
 */
import type { TrackerCoreContext } from './context.js';
import type { TrackerRecord } from './trackerRecord.js';
/** Built-in release type. */
export declare const RELEASE_TYPE = "release";
export interface ReleaseFinalizeInput {
    version: string;
    /** Git tag; defaults to `v<version>`. */
    gitTag?: string;
    channel?: string;
    /** ISO timestamp; defaults to the caller-supplied clock. */
    releasedAt?: string;
}
/**
 * The field writes that finalize a release. Returned rather than applied so the
 * caller owns the single tracker write (and its sync semantics).
 */
export declare function releaseFinalizeFields(input: ReleaseFinalizeInput, nowIso: string): Record<string, unknown>;
/**
 * Releases still open for finalizing, newest bucket first. A workspace normally
 * has exactly one; zero means nobody created the next-release item, and more
 * than one means the caller must disambiguate rather than guess.
 */
export declare function findPendingReleases(ctx: TrackerCoreContext, items: TrackerRecord[], getStatus: (record: TrackerRecord) => string): TrackerRecord[];
export interface ReleaseNoteLine {
    /** Member's tracker type, for grouping. */
    type: string;
    title: string;
    issueKey?: string;
}
/** Release member ids, deduped and in stored order. */
export declare function releaseMemberIds(ctx: TrackerCoreContext, release: TrackerRecord): string[];
/**
 * The release's members as note lines, grouped by type in member order.
 * Unresolved ids (members we don't have loaded) and archived members are
 * skipped -- release notes should never invent an entry for something we can't
 * read.
 */
export declare function releaseNoteLines(ctx: TrackerCoreContext, release: TrackerRecord, itemsById: ReadonlyMap<string, TrackerRecord>, getTitle: (record: TrackerRecord) => string): ReleaseNoteLine[];
/** CHANGELOG-shaped markdown for a release's members, grouped by type. */
export declare function renderReleaseNotes(lines: ReleaseNoteLine[]): string;
