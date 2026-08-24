import log from 'electron-log/main';

const logger = log.scope('GhApiHelpers');

export type GithubIssueState = 'open' | 'closed' | 'all';

export class GhApiError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'GhApiError';
  }
}

/** Find the endpoint in a `gh api` argv list, including mutations with leading flags. */
export function getGhApiEndpoint(args: string[]): string {
  const valueOptions = new Set([
    '-X', '--method', '-H', '--header', '-f', '--raw-field', '-F', '--field', '--cache',
  ]);
  for (let index = args[0] === 'api' ? 1 : 0; index < args.length; index += 1) {
    const arg = args[index];
    if (valueOptions.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('-')) return arg;
  }
  return '';
}

/** Return the HTTP method without retaining any field or header values. */
export function getGhApiMethod(args: string[]): string {
  const methodIndex = args.findIndex((arg) => arg === '-X' || arg === '--method');
  const method = methodIndex >= 0 ? args[methodIndex + 1] : undefined;
  return typeof method === 'string' && method.length > 0 ? method.toUpperCase() : 'GET';
}

export const GH_WORKFLOW_SCOPE_REFRESH_COMMAND = 'gh auth refresh -h github.com -s workflow';

export function getWorkflowScopeRecoveryMessage(stderr: string): string | null {
  const missingScope =
    /refusing to allow an OAuth App to create or update workflow .* without [`'"]?workflow[`'"]? scope/i;
  if (!missingScope.test(stderr)) return null;
  return (
    'GitHub blocked this merge because the PR changes a workflow file and the active GitHub CLI token lacks the `workflow` scope. ' +
    `Run: ${GH_WORKFLOW_SCOPE_REFRESH_COMMAND}`
  );
}

export function assertWorkspacePath(workspacePath: string): void {
  if (typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
    throw new Error('workspacePath required');
  }
}

export function assertGithubRemote(remote: string): void {
  const valid =
    typeof remote === 'string' &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+$/.test(remote);
  // `.` and `..` satisfy the repo segment above but turn `repos/<remote>/issues`
  // into a traversal-shaped request path.
  const repo = valid ? remote.slice(remote.indexOf('/') + 1) : '';
  if (!valid || repo === '.' || repo === '..') {
    throw new Error(`Invalid GitHub remote: ${String(remote)}`);
  }
}

export function assertGithubIssueNumber(number: number): void {
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`Invalid GitHub issue number: ${String(number)}`);
  }
}

export function assertGithubIssueState(state: string): asserts state is GithubIssueState {
  if (state !== 'open' && state !== 'closed' && state !== 'all') {
    throw new Error(`Invalid GitHub issue state: ${state}`);
  }
}

export function assertGithubWritableIssueState(
  state: unknown,
): asserts state is 'open' | 'closed' {
  if (state !== 'open' && state !== 'closed') {
    throw new Error(`Invalid writable GitHub issue state: ${String(state)}`);
  }
}

export function normalizeGithubSince(since: string | undefined): string | undefined {
  if (since === undefined) return undefined;
  if (typeof since !== 'string' || since.trim().length === 0) {
    throw new Error('Invalid GitHub issues since timestamp');
  }
  const time = Date.parse(since);
  if (!Number.isFinite(time)) {
    throw new Error(`Invalid GitHub issues since timestamp: ${since}`);
  }
  return new Date(time).toISOString();
}

/**
 * Exported for tests. `--cache` is deliberately dropped whenever `--paginate`
 * is set: gh merges pages by splicing the page bodies together, and that
 * splice races against its own shared on-disk cache when several gh processes
 * run at once, emitting JSON that closes the merged array after page one
 * (`[…page1…],{…},{…}]`). Reproduced against gh 2.92.0.
 */
export function buildApiArgs(
  endpoint: string,
  options: { cacheSeconds?: number; paginate?: boolean } = {},
): string[] {
  const args = [
    'api',
    endpoint,
    '-H',
    'Accept: application/vnd.github+json',
    '-H',
    'X-GitHub-Api-Version: 2022-11-28',
  ];
  if (options.paginate) {
    args.push('--paginate');
  }
  if (!options.paginate && options.cacheSeconds && options.cacheSeconds > 0) {
    args.push('--cache', `${options.cacheSeconds}s`);
  }
  return args;
}

/**
 * `gh api --paginate` returns multiple JSON arrays concatenated on stdout
 * (one per page). Parse defensively: try single parse first, then fall back
 * to walking the top-level values.
 *
 * Exported for tests. The fallback must survive gh emitting a *malformed*
 * merge — `[…page1…],{…},{…}]` — which it does when its page splicing races
 * the shared on-disk cache. Anything between top-level values (the
 * separating commas, whitespace, and that stray trailing `]`) is skipped, so
 * later pages are recovered one object at a time instead of being dropped.
 */
export function parsePagedJson<T>(stdout: string): T[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  // Single JSON value (most common).
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as T[]) : [parsed as T];
  } catch {
    // Fall through to the top-level walk.
  }

  const out: T[] = [];
  let depth = 0;
  let sliceStart = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (depth === 0 && character !== '[' && character !== '{') {
      // Separator, whitespace, or a stray closer left over from a bad merge.
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '[' || character === '{') {
      if (depth === 0) sliceStart = index;
      depth += 1;
    } else if (character === ']' || character === '}') {
      depth -= 1;
      if (depth === 0) {
        const slice = trimmed.slice(sliceStart, index + 1);
        try {
          const parsed = JSON.parse(slice) as T[] | T;
          if (Array.isArray(parsed)) out.push(...parsed);
          else out.push(parsed);
        } catch (error) {
          logger.warn('Failed to parse gh api chunk', {
            chunkLength: slice.length,
            preview: slice.slice(0, 200),
            error,
          });
        }
        sliceStart = -1;
      }
    }
  }
  return out;
}
