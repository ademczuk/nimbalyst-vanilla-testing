/**
 * Decide whether a shell command line directly invokes Git.
 *
 * Used to surface an agent's Git commands in the activity indicator. It has to
 * be structural rather than a substring test: `echo git`, a path containing
 * "git", and `npm test` (whose script may run Git internally) must all stay
 * silent, or the indicator becomes noise the user learns to ignore. Equally,
 * `env GIT_OPTIONAL_LOCKS=0 git status` and `cd pkg && git diff` are real Git
 * invocations that a naive "starts with git" check would miss.
 *
 * Scope is deliberately the top level of the command line. Git spawned inside an
 * opaque script, or inside a command substitution, is out of scope -- we can
 * only honestly report what the command line itself states.
 */

/** One top-level `git ...` invocation found in a command line. */
export interface DirectGitSegment {
  /** Arguments after the `git` executable, in order. */
  args: string[];
  /** The executable exactly as written (`git`, `/usr/bin/git`, ...). */
  executable: string;
}

const SEPARATORS = new Set([';', '&', '|', '(', ')', '\n']);

/**
 * Split into top-level segments and tokenize each, honouring quoting so a
 * separator inside `'a && b'` does not split the line.
 */
function splitSegments(command: string): string[][] {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let current = '';
  let hasCurrent = false;
  let quote: '"' | "'" | null = null;

  const endToken = () => {
    if (hasCurrent) {
      tokens.push(current);
      current = '';
      hasCurrent = false;
    }
  };
  const endSegment = () => {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (
        quote === '"'
        && char === '\\'
        && i + 1 < command.length
        // Inside double quotes a backslash only escapes these; before anything
        // else it is a literal backslash. Stripping it unconditionally mangled
        // quoted Windows paths ("C:\Program Files\Git\bin\git.exe") into a
        // single unrecognizable token.
        && ['$', '`', '"', '\\', '\n'].includes(command[i + 1])
      ) {
        const next = command[++i];
        if (next !== '\n') {
          current += next;
          hasCurrent = true;
        }
      } else {
        current += char;
        hasCurrent = true;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      // An empty quoted string is still a token: `git commit -m ''`.
      hasCurrent = true;
      continue;
    }

    if (char === '\\' && i + 1 < command.length) {
      // A backslash-newline is a line continuation, not a token character.
      if (command[i + 1] === '\n') {
        i++;
        continue;
      }
      current += command[++i];
      hasCurrent = true;
      continue;
    }

    if (SEPARATORS.has(char)) {
      endSegment();
      continue;
    }

    if (char === ' ' || char === '\t' || char === '\r') {
      endToken();
      continue;
    }

    current += char;
    hasCurrent = true;
  }

  endSegment();
  return segments;
}

/** `VAR=value` prefixes and a leading `env VAR=value ...` both precede the real command. */
function stripCommandPrefixes(tokens: string[]): string[] {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index++;
      continue;
    }
    if (basename(token) === 'env' || basename(token) === 'env.exe') {
      index++;
      // `env` takes flags and assignments before the command it runs.
      while (
        index < tokens.length
        && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]) || tokens[index].startsWith('-'))
      ) {
        index++;
      }
      continue;
    }
    break;
  }
  return tokens.slice(index);
}

function basename(token: string): string {
  const normalized = token.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function isGitExecutable(token: string): boolean {
  const name = basename(token).toLowerCase();
  return name === 'git' || name === 'git.exe';
}

/** Every top-level `git ...` invocation in `command`, in order. */
export function findDirectGitSegments(command: string): DirectGitSegment[] {
  if (!command || !command.includes('git')) return [];

  const found: DirectGitSegment[] = [];
  for (const rawTokens of splitSegments(command)) {
    const tokens = stripCommandPrefixes(rawTokens);
    const [executable, ...args] = tokens;
    if (executable && isGitExecutable(executable)) {
      found.push({ executable, args });
    }
  }
  return found;
}

/** Whether `command` directly invokes Git at least once. */
export function containsDirectGitCommand(command: string): boolean {
  return findDirectGitSegments(command).length > 0;
}

/**
 * Git subcommands that only read. Deliberately an allowlist: anything unlisted
 * is assumed to write, so a new or misjudged subcommand costs one extra status
 * read rather than a stale branch indicator.
 *
 * Subcommands that read in one form and write in another (`branch -d`,
 * `remote add`, `config --global x y`, `stash`, `tag`, `notes`) are left off --
 * distinguishing them means parsing each one's flags, and getting it wrong is
 * exactly the failure this guards against.
 */
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'blame', 'cat-file', 'check-ignore', 'count-objects', 'describe', 'diff',
  'diff-index', 'diff-tree', 'grep', 'help', 'log', 'ls-files', 'ls-remote',
  'ls-tree', 'merge-base', 'name-rev', 'reflog', 'rev-list', 'rev-parse',
  'shortlog', 'show', 'status', 'var', 'version', 'whatchanged',
]);

/** Commands that change nothing in the repository, so they need no re-read. */
const INERT_NON_GIT_COMMANDS = new Set(['cd', 'pwd', 'true', 'echo']);

function gitSubcommand(args: string[]): string | undefined {
  // Skip git's own leading options (`-C dir`, `--no-pager`, `-c k=v`).
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) return arg;
    if (arg === '-C' || arg === '-c') i++;
  }
  return undefined;
}

/**
 * Whether a whole command line provably leaves the repository unchanged.
 *
 * Used to skip the post-operation status refresh for an agent's `git status` or
 * `git log`: those cannot have moved refs, the index, or the worktree, and
 * refreshing after each one would re-read status and reload the Git panel for
 * nothing. Anything it cannot prove is treated as a writer.
 */
export function isReadOnlyGitCommandLine(command: string): boolean {
  if (!command) return false;

  const segments = splitSegments(command).map(stripCommandPrefixes);
  if (segments.length === 0) return false;

  let sawGit = false;
  for (const tokens of segments) {
    const [executable, ...args] = tokens;
    if (!executable) continue;

    if (isGitExecutable(executable)) {
      const subcommand = gitSubcommand(args);
      if (!subcommand || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return false;
      sawGit = true;
      continue;
    }

    // A non-git segment could build, install, or generate files, changing the
    // dirty state even though no git command wrote anything.
    if (!INERT_NON_GIT_COMMANDS.has(basename(executable))) return false;
  }

  return sawGit;
}
