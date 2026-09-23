/**
 * Citation locators (knowledge-scopes contract 4.4) and decision bindings (4.9).
 *
 * A locator is the address of the exact passage a citation rests on, or of the
 * exact artifact a decision governs. One module validates every selector for
 * both uses, because they are the same addresses: `governs` reuses 4.4's
 * selectors unchanged and adds `scope-node` for a record inside a scope.
 *
 * Three properties shape this file.
 *
 * **Stable codes.** Every failure carries a `LOCATOR_*` code. Desktop, the web
 * console, and both MCP surfaces validate with this module, so a rejected
 * locator reports identically wherever it was written. A message is for a
 * human; a code is what a caller may branch on.
 *
 * **Strict in both directions.** An unknown `selectorType`, an unknown
 * `version`, and an unrecognized property are all rejections. A tolerated typo
 * (`startline` for `startLine`) does not produce a slightly-wrong locator, it
 * produces one that addresses a whole file while claiming to address five
 * lines, and nothing downstream can tell. Evolution goes through `version`,
 * which is exactly what it is there for.
 *
 * **A pinned revision is the UUID.** `scope-node` carries `revisionId`, never
 * the room-assigned integer: `serverRevision` does not exist in the personal
 * scope at all, and does not exist for a team record until its write syncs, so
 * binding to it would force a rewrite of the locator when the number arrived.
 * Rewriting a binding in place is the one thing 4.9 forbids. `serverRevision`
 * is accepted as a display hint and is never used to resolve anything.
 *
 * **`revisionId` is always a UUID, so `scope-node` only addresses scopes that
 * mint one.** `me:`, `team:` and `org:` records carry 4.2 revision identity; a
 * `public:` scope publishes by release and its revisions are 4.3's opaque
 * strings (`2026-09-15.3`, `sha256:...`), resolved by re-fetching that scope's
 * bundle rather than by reading a record's chain. Accepting a `public:` scope
 * id here would mint a binding that passes shape validation and can never
 * resolve, which is indistinguishable from one that went stale the day it was
 * written -- and an unresolvable binding is precisely 4.9's staleness signal.
 * The cross-scope case is a claim whose subject is a 4.3 external reference,
 * not a `governs` binding. A public `governs` target, if it is ever wanted,
 * arrives as `scope-node` version 2 carrying `revision`.
 *
 * This module checks SHAPE. It does not resolve: it cannot say whether the
 * commit exists, whether the quote still appears, or whether `scopeId` is a
 * declared upstream (that is 4.3's `KNOWLEDGE_DOWNSTREAM_REFERENCE`, which
 * needs a per-project scope resolver). Resolution is checked, never repaired.
 */
/** Selector families from 4.4, plus 4.9's intra-scope addition. */
export type CitationLocatorSelectorType = 'repo-lines' | 'html-fragment' | 'pdf-page' | 'media-time' | 'result-path' | 'scope-node';
export declare const CITATION_LOCATOR_SELECTOR_TYPES: readonly CitationLocatorSelectorType[];
/** Only version 1 exists. A future shape change increments this, never mutates it. */
export declare const CITATION_LOCATOR_VERSION = 1;
export type CitationLocatorErrorCode = 'LOCATOR_NOT_AN_OBJECT' | 'LOCATOR_MISSING_SELECTOR_TYPE' | 'LOCATOR_UNKNOWN_SELECTOR_TYPE' | 'LOCATOR_MISSING_VERSION' | 'LOCATOR_UNSUPPORTED_VERSION' | 'LOCATOR_MISSING_FIELD' | 'LOCATOR_INVALID_FIELD' | 'LOCATOR_RANGE_INVERTED' | 'LOCATOR_UNKNOWN_FIELD' | 'LOCATOR_NOT_AN_ARRAY'
/** A `scope-node` naming a scope that carries no 4.2 revision identity. */
 | 'LOCATOR_SCOPE_NODE_UNVERSIONED_SCOPE';
export interface CitationLocatorIssue {
    code: CitationLocatorErrorCode;
    /**
     * The offending property, or `''` when the locator as a whole is at fault.
     * For a multi-valued field each entry is prefixed, e.g. `[2].startLine`.
     */
    path: string;
    message: string;
}
export interface RepoLinesLocator {
    selectorType: 'repo-lines';
    version: 1;
    /** Host-qualified, e.g. `github.com/x/y`. Not a URL, so forks compare equal. */
    repository: string;
    /** A resolved commit sha. A branch name is not an address. */
    commit: string;
    /** Repository-relative path. */
    path: string;
    /** 1-based, inclusive. */
    startLine: number;
    /** 1-based, inclusive, never before `startLine`. */
    endLine: number;
}
export interface HtmlFragmentLocator {
    selectorType: 'html-fragment';
    version: 1;
    fragment?: string;
    /** Exact quoted text. */
    quote?: string;
    prefix?: string;
    suffix?: string;
}
export interface PdfPageLocator {
    selectorType: 'pdf-page';
    version: 1;
    /** 1-based page number. */
    page: number;
    quote?: string;
}
export interface MediaTimeLocator {
    selectorType: 'media-time';
    version: 1;
    /** Seconds from the start of the media. */
    start: number;
    /** Seconds, never before `start`. Absent addresses an instant. */
    end?: number;
}
export interface ResultPathLocator {
    selectorType: 'result-path';
    version: 1;
    /** `<algorithm>-<value>`, e.g. `sha256-abc...`. */
    artifactDigest: string;
    /** JSONPath into the artifact, e.g. `$.checks[2].outcome`. */
    path: string;
}
export interface ScopeNodeLocator {
    selectorType: 'scope-node';
    version: 1;
    /**
     * `me:`, `team:<projectId>`, or `org:<orgId>`. Not `public:` -- see the
     * module header and {@link SCOPE_NODE_REVISIONED_SCOPE_PATTERN}.
     */
    scopeId: string;
    nodeId: string;
    /** The pinned revision's UUID. */
    revisionId: string;
    /** Room-assigned display number. Advisory; never used to resolve. */
    serverRevision?: number;
}
export type CitationLocator = RepoLinesLocator | HtmlFragmentLocator | PdfPageLocator | MediaTimeLocator | ResultPathLocator | ScopeNodeLocator;
export type CitationLocatorValidation = {
    valid: true;
    locator: CitationLocator;
    issues: [];
} | {
    valid: false;
    locator: null;
    issues: CitationLocatorIssue[];
};
/**
 * The subset of section 3's scopes whose records carry 4.2 revision identity,
 * and therefore the only scopes a `scope-node` may address. Checked separately
 * from {@link SCOPE_ID_PATTERN} so a malformed scope id and a well-formed one
 * in the wrong scope kind report distinct codes.
 */
export declare const SCOPE_NODE_REVISIONED_SCOPE_PATTERN: RegExp;
/**
 * Validate one locator. Returns the narrowed locator on success and the full
 * list of issues on failure, never a partially-accepted value.
 *
 * Collects every issue rather than stopping at the first, so a form or an MCP
 * caller can fix a locator in one pass instead of one round trip per property.
 */
export declare function validateCitationLocator(value: unknown): CitationLocatorValidation;
export type CitationLocatorListValidation = {
    valid: true;
    locators: CitationLocator[];
    issues: [];
} | {
    valid: false;
    locators: null;
    issues: CitationLocatorIssue[];
};
/**
 * Validate a multi-valued locator field: `governs` on a decision-record, and
 * any other field declared with `objectShape: 'citation-locator'` and
 * `multiValue`. Issue paths are prefixed with the entry index so a caller can
 * point at the offending row.
 *
 * An empty array is valid here. 4.9's `KNOWLEDGE_UNBOUND_DECISION` is a warning
 * about a PUBLISHED decision with no bindings, which needs the item's
 * publication state; shape validation is not where that decision belongs.
 */
export declare function validateCitationLocatorList(value: unknown): CitationLocatorListValidation;
/**
 * A one-line human summary, for a chip or a table cell. Deliberately lossy: the
 * inspector renders the full locator, this is the label you click to open it.
 */
export declare function describeCitationLocator(locator: CitationLocator): string;
