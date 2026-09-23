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
export type CitationLocatorSelectorType =
  | 'repo-lines'
  | 'html-fragment'
  | 'pdf-page'
  | 'media-time'
  | 'result-path'
  | 'scope-node';

export const CITATION_LOCATOR_SELECTOR_TYPES: readonly CitationLocatorSelectorType[] = [
  'repo-lines',
  'html-fragment',
  'pdf-page',
  'media-time',
  'result-path',
  'scope-node',
];

/** Only version 1 exists. A future shape change increments this, never mutates it. */
export const CITATION_LOCATOR_VERSION = 1;

export type CitationLocatorErrorCode =
  | 'LOCATOR_NOT_AN_OBJECT'
  | 'LOCATOR_MISSING_SELECTOR_TYPE'
  | 'LOCATOR_UNKNOWN_SELECTOR_TYPE'
  | 'LOCATOR_MISSING_VERSION'
  | 'LOCATOR_UNSUPPORTED_VERSION'
  | 'LOCATOR_MISSING_FIELD'
  | 'LOCATOR_INVALID_FIELD'
  | 'LOCATOR_RANGE_INVERTED'
  | 'LOCATOR_UNKNOWN_FIELD'
  | 'LOCATOR_NOT_AN_ARRAY'
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

export type CitationLocator =
  | RepoLinesLocator
  | HtmlFragmentLocator
  | PdfPageLocator
  | MediaTimeLocator
  | ResultPathLocator
  | ScopeNodeLocator;

export type CitationLocatorValidation =
  | { valid: true; locator: CitationLocator; issues: [] }
  | { valid: false; locator: null; issues: CitationLocatorIssue[] };

/** Scope-id grammar from section 3. `me:` is the whole personal scope id. */
const SCOPE_ID_PATTERN = /^(?:me:|(?:team|org|public):[A-Za-z0-9._-]+)$/;

/**
 * The subset of section 3's scopes whose records carry 4.2 revision identity,
 * and therefore the only scopes a `scope-node` may address. Checked separately
 * from {@link SCOPE_ID_PATTERN} so a malformed scope id and a well-formed one
 * in the wrong scope kind report distinct codes.
 */
export const SCOPE_NODE_REVISIONED_SCOPE_PATTERN = /^(?:me:|(?:team|org):[A-Za-z0-9._-]+)$/;

/** RFC 4122 shape, any version: the desktop trigger, the browser, and the room all mint these. */
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** `<algorithm>-<value>`; the algorithm itself is not this module's business. */
const DIGEST_PATTERN = /^[a-z0-9]+-[A-Za-z0-9+/=_-]+$/;

/** A resolved object id: hex sha, or any non-whitespace commit-ish the host resolved. */
const COMMIT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Properties every selector may carry. */
const COMMON_KEYS = ['selectorType', 'version'] as const;

const SELECTOR_KEYS: Record<CitationLocatorSelectorType, readonly string[]> = {
  'repo-lines': ['repository', 'commit', 'path', 'startLine', 'endLine'],
  'html-fragment': ['fragment', 'quote', 'prefix', 'suffix'],
  'pdf-page': ['page', 'quote'],
  'media-time': ['start', 'end'],
  'result-path': ['artifactDigest', 'path'],
  'scope-node': ['scopeId', 'nodeId', 'revisionId', 'serverRevision'],
};

function issue(code: CitationLocatorErrorCode, path: string, message: string): CitationLocatorIssue {
  return { code, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A required non-empty string. Whitespace-only is empty: a locator whose path
 * is `"  "` addresses nothing, and accepting it defers the failure to whoever
 * tries to resolve it.
 */
function requireString(
  raw: Record<string, unknown>,
  key: string,
  issues: CitationLocatorIssue[],
  pattern?: { re: RegExp; expectation: string },
): void {
  const value = raw[key];
  if (value === undefined || value === null) {
    issues.push(issue('LOCATOR_MISSING_FIELD', key, `'${key}' is required`));
    return;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(issue('LOCATOR_INVALID_FIELD', key, `'${key}' must be a non-empty string`));
    return;
  }
  if (pattern && !pattern.re.test(value)) {
    issues.push(issue('LOCATOR_INVALID_FIELD', key, `'${key}' ${pattern.expectation}`));
  }
}

function checkOptionalString(
  raw: Record<string, unknown>,
  key: string,
  issues: CitationLocatorIssue[],
): void {
  const value = raw[key];
  if (value === undefined) return;
  if (typeof value !== 'string') {
    issues.push(issue('LOCATOR_INVALID_FIELD', key, `'${key}' must be a string when present`));
  }
}

function requireInteger(
  raw: Record<string, unknown>,
  key: string,
  minimum: number,
  issues: CitationLocatorIssue[],
): number | null {
  const value = raw[key];
  if (value === undefined || value === null) {
    issues.push(issue('LOCATOR_MISSING_FIELD', key, `'${key}' is required`));
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    issues.push(
      issue('LOCATOR_INVALID_FIELD', key, `'${key}' must be an integer >= ${minimum}`),
    );
    return null;
  }
  return value;
}

function requireNumber(
  raw: Record<string, unknown>,
  key: string,
  minimum: number,
  issues: CitationLocatorIssue[],
): number | null {
  const value = raw[key];
  if (value === undefined || value === null) {
    issues.push(issue('LOCATOR_MISSING_FIELD', key, `'${key}' is required`));
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    issues.push(issue('LOCATOR_INVALID_FIELD', key, `'${key}' must be a finite number >= ${minimum}`));
    return null;
  }
  return value;
}

/**
 * A repository-relative path. A leading `/` or a `..` segment means the locator
 * escapes the repository it names, which is not an address inside it.
 */
function checkRepositoryPath(raw: Record<string, unknown>, issues: CitationLocatorIssue[]): void {
  const before = issues.length;
  requireString(raw, 'path', issues);
  if (issues.length !== before) return;
  const value = raw.path as string;
  if (value.startsWith('/') || value.split('/').includes('..')) {
    issues.push(
      issue(
        'LOCATOR_INVALID_FIELD',
        'path',
        `'path' must be repository-relative, with no leading slash and no '..' segment`,
      ),
    );
  }
}

function validateBySelector(
  selectorType: CitationLocatorSelectorType,
  raw: Record<string, unknown>,
  issues: CitationLocatorIssue[],
): void {
  switch (selectorType) {
    case 'repo-lines': {
      requireString(raw, 'repository', issues);
      requireString(raw, 'commit', issues, {
        re: COMMIT_PATTERN,
        expectation: 'must be a resolved commit id, not a path or URL',
      });
      checkRepositoryPath(raw, issues);
      const start = requireInteger(raw, 'startLine', 1, issues);
      const end = requireInteger(raw, 'endLine', 1, issues);
      if (start !== null && end !== null && end < start) {
        issues.push(
          issue('LOCATOR_RANGE_INVERTED', 'endLine', `'endLine' (${end}) is before 'startLine' (${start})`),
        );
      }
      return;
    }
    case 'html-fragment': {
      for (const key of SELECTOR_KEYS['html-fragment']) checkOptionalString(raw, key, issues);
      // Every property is optional individually, but a locator carrying neither
      // a fragment nor a quote addresses the whole document while claiming to
      // address a passage.
      const hasFragment = typeof raw.fragment === 'string' && raw.fragment.trim().length > 0;
      const hasQuote = typeof raw.quote === 'string' && raw.quote.trim().length > 0;
      if (!hasFragment && !hasQuote) {
        issues.push(
          issue(
            'LOCATOR_MISSING_FIELD',
            '',
            `'html-fragment' requires at least one of 'fragment' or 'quote'`,
          ),
        );
      }
      return;
    }
    case 'pdf-page': {
      requireInteger(raw, 'page', 1, issues);
      checkOptionalString(raw, 'quote', issues);
      return;
    }
    case 'media-time': {
      const start = requireNumber(raw, 'start', 0, issues);
      if (raw.end === undefined) return;
      const end = requireNumber(raw, 'end', 0, issues);
      if (start !== null && end !== null && end < start) {
        issues.push(
          issue('LOCATOR_RANGE_INVERTED', 'end', `'end' (${end}) is before 'start' (${start})`),
        );
      }
      return;
    }
    case 'result-path': {
      requireString(raw, 'artifactDigest', issues, {
        re: DIGEST_PATTERN,
        expectation: `must look like '<algorithm>-<value>', e.g. 'sha256-...'`,
      });
      const before = issues.length;
      requireString(raw, 'path', issues);
      if (issues.length === before && !(raw.path as string).startsWith('$')) {
        issues.push(
          issue('LOCATOR_INVALID_FIELD', 'path', `'path' must be a JSONPath beginning with '$'`),
        );
      }
      return;
    }
    case 'scope-node': {
      const beforeScope = issues.length;
      requireString(raw, 'scopeId', issues, {
        re: SCOPE_ID_PATTERN,
        expectation: `must be 'me:', 'team:<id>', or 'org:<id>'`,
      });
      // A well-formed scope id in a scope that assigns no revision UUID. See
      // the module header: this binding could never resolve.
      if (issues.length === beforeScope && !SCOPE_NODE_REVISIONED_SCOPE_PATTERN.test(raw.scopeId as string)) {
        issues.push(
          issue(
            'LOCATOR_SCOPE_NODE_UNVERSIONED_SCOPE',
            'scopeId',
            `'scope-node' addresses a record by revision UUID, which scope '${raw.scopeId as string}' does not assign; reference it as an external reference instead`,
          ),
        );
      }
      requireString(raw, 'nodeId', issues);
      // The UUID, never the room's integer. See the module header.
      requireString(raw, 'revisionId', issues, {
        re: UUID_PATTERN,
        expectation: 'must be a revision UUID, not a room-assigned revision number',
      });
      if (raw.serverRevision !== undefined) requireInteger(raw, 'serverRevision', 1, issues);
      return;
    }
  }
}

/**
 * Validate one locator. Returns the narrowed locator on success and the full
 * list of issues on failure, never a partially-accepted value.
 *
 * Collects every issue rather than stopping at the first, so a form or an MCP
 * caller can fix a locator in one pass instead of one round trip per property.
 */
export function validateCitationLocator(value: unknown): CitationLocatorValidation {
  if (!isPlainObject(value)) {
    return {
      valid: false,
      locator: null,
      issues: [issue('LOCATOR_NOT_AN_OBJECT', '', 'A locator must be an object')],
    };
  }

  const issues: CitationLocatorIssue[] = [];
  const selectorType = value.selectorType;

  if (selectorType === undefined || selectorType === null || selectorType === '') {
    issues.push(issue('LOCATOR_MISSING_SELECTOR_TYPE', 'selectorType', `'selectorType' is required`));
    return { valid: false, locator: null, issues };
  }
  if (
    typeof selectorType !== 'string'
    || !CITATION_LOCATOR_SELECTOR_TYPES.includes(selectorType as CitationLocatorSelectorType)
  ) {
    issues.push(
      issue(
        'LOCATOR_UNKNOWN_SELECTOR_TYPE',
        'selectorType',
        `Unknown selectorType '${String(selectorType)}'; expected one of ${CITATION_LOCATOR_SELECTOR_TYPES.join(', ')}`,
      ),
    );
    // Nothing else is checkable without knowing the selector.
    return { valid: false, locator: null, issues };
  }
  const selector = selectorType as CitationLocatorSelectorType;

  if (value.version === undefined || value.version === null) {
    issues.push(issue('LOCATOR_MISSING_VERSION', 'version', `'version' is required`));
  } else if (value.version !== CITATION_LOCATOR_VERSION) {
    issues.push(
      issue(
        'LOCATOR_UNSUPPORTED_VERSION',
        'version',
        `Unsupported locator version ${String(value.version)}; this build understands ${CITATION_LOCATOR_VERSION}`,
      ),
    );
  }

  const allowed = new Set<string>([...COMMON_KEYS, ...SELECTOR_KEYS[selector]]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push(
        issue(
          'LOCATOR_UNKNOWN_FIELD',
          key,
          `'${key}' is not part of a '${selector}' locator`,
        ),
      );
    }
  }

  validateBySelector(selector, value, issues);

  if (issues.length > 0) return { valid: false, locator: null, issues };
  return { valid: true, locator: value as unknown as CitationLocator, issues: [] };
}

export type CitationLocatorListValidation =
  | { valid: true; locators: CitationLocator[]; issues: [] }
  | { valid: false; locators: null; issues: CitationLocatorIssue[] };

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
export function validateCitationLocatorList(value: unknown): CitationLocatorListValidation {
  if (!Array.isArray(value)) {
    return {
      valid: false,
      locators: null,
      issues: [issue('LOCATOR_NOT_AN_ARRAY', '', 'A multi-valued locator field must be an array')],
    };
  }
  const issues: CitationLocatorIssue[] = [];
  const locators: CitationLocator[] = [];
  value.forEach((entry, index) => {
    const result = validateCitationLocator(entry);
    if (result.valid) {
      locators.push(result.locator);
      return;
    }
    for (const entryIssue of result.issues) {
      issues.push({
        ...entryIssue,
        path: entryIssue.path ? `[${index}].${entryIssue.path}` : `[${index}]`,
      });
    }
  });
  if (issues.length > 0) return { valid: false, locators: null, issues };
  return { valid: true, locators, issues: [] };
}

/**
 * A one-line human summary, for a chip or a table cell. Deliberately lossy: the
 * inspector renders the full locator, this is the label you click to open it.
 */
export function describeCitationLocator(locator: CitationLocator): string {
  switch (locator.selectorType) {
    case 'repo-lines':
      return `${locator.path}:${locator.startLine}`
        + (locator.endLine > locator.startLine ? `-${locator.endLine}` : '')
        + ` @ ${locator.commit.slice(0, 8)}`;
    case 'html-fragment':
      return locator.fragment ? `#${locator.fragment.replace(/^#/, '')}` : `"${locator.quote ?? ''}"`;
    case 'pdf-page':
      return `p. ${locator.page}`;
    case 'media-time':
      return locator.end === undefined
        ? formatMediaTime(locator.start)
        : `${formatMediaTime(locator.start)}-${formatMediaTime(locator.end)}`;
    case 'result-path':
      return `${locator.path} @ ${locator.artifactDigest.slice(0, 15)}`;
    case 'scope-node': {
      // `me:` already ends in the separator; `team:<id>` does not.
      const prefix = locator.scopeId.endsWith(':') ? locator.scopeId : `${locator.scopeId}:`;
      return `${prefix}${locator.nodeId}`
        + (locator.serverRevision === undefined ? '' : ` rev ${locator.serverRevision}`);
    }
  }
}

function formatMediaTime(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
