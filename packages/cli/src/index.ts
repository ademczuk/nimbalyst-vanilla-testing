/**
 * nim — companion CLI for Nimbalyst trackers and agent interop.
 *
 * Entry point: parse argv, dispatch the noun, translate thrown CliErrors into
 * stable exit codes. All command output goes to stdout; diagnostics to stderr.
 */
import { parseArgs, flagBool } from './cli/parse.js';
import { setColorEnabled } from './cli/colors.js';
import { CliError, ExitCode } from './cli/exitCodes.js';
import { safeText } from './cli/output.js';
import { runTracker } from './commands/tracker.js';
import { runStatus } from './commands/status.js';
import { runWorkspace } from './commands/workspace.js';
import { runSession, runDoc } from './commands/sessionDoc.js';
import { runRelease } from './commands/release.js';
import { runLogin, runLogout, runWhoami } from './commands/login.js';
import { runWiki } from './commands/wiki.js';
import { githubNativeEnabled } from './cloud/config.js';

export const VERSION = '0.1.0';

/** The hosted-wiki block; the GitHub-native membership commands only appear under NIM_GITHUB_NATIVE=on. */
function wikiHelp(): string {
  if (githubNativeEnabled()) {
    return `Hosted wiki (GitHub-native mode; server = NIM_SERVER, default https://sync.nimbalyst.com):
  nim login / nim logout / nim whoami                (GitHub sign-in)
  nim wiki status [--join-secret S]
  nim wiki create --policy invite|repo-link       (writes .nimbalyst/wiki.json)
  nim wiki invite <githubLogin> / nim wiki remove-member <githubLogin>
  nim wiki rotate-secret
${WIKI_CONTENT_HELP}
  Wiki flags: --repo <remote|wiki:id> (default: origin, else .nimbalyst/wiki.json),
              --changeset <id> (required by the server on create-item, update-item, define-type)
`;
  }
  return `Hosted wiki (Nimbalyst Teams sign-in; server = NIM_SERVER, default https://sync.nimbalyst.com):
  nim login / nim logout / nim whoami
  nim wiki status                            (unbound, bound, or ambiguous, with your teams)
  nim wiki bind --org <id> --project <id>    (team admins: connect this repo's remote)
  nim wiki create-project --org <id> --name <n> [--bind]   (team admins)
  nim wiki pin --org <id> --project <id>     (writes .nimbalyst/wiki.json; one of the projects this repo resolves to)
${WIKI_CONTENT_HELP}
  Wiki flags: --repo <remote> (default: origin; ignores .nimbalyst/wiki.json),
              --org <id> --project <id> (explicit project; ignores .nimbalyst/wiki.json),
              --changeset <id> (required by the server on create-item, update-item, define-type)
`;
}

const WIKI_CONTENT_HELP = `  nim wiki types
  nim wiki define-type [-f <schema.yaml|.json>] [--overwrite] [--predicates-file F]
  nim wiki list [--type T] [--status S] [--search TXT] [--limit N]
  nim wiki get <id>
  nim wiki create-item <type> "<title>" [--status S] [--field k=v ...] [--body TXT | --body-file F]
  nim wiki update-item <id> [--title T] [--status S] [--field k=v ...] [--unset f ...]
  nim wiki changes [--limit N] [--before C]      (activity log of what each session wrote)
  nim wiki changes show <changesetId>
  nim wiki changes begin --title T [--source S] [--session-ref R]  (-q prints the id)
  nim wiki changes finish <changesetId> [--summary TXT]`;

const help = () => `nim — Nimbalyst companion CLI (v${VERSION})

Usage:
  nim <noun> <verb> [--flags]

Nouns:
  tracker     trackers (bugs, tasks, decisions, imported records) — read in v1
  release     release items — list, finalize at build time, generate notes
  session     AI sessions (read-only in v1)
  doc         workspace documents (read-only in v1)
  workspace   list / show workspaces
  status      what nim is connected to (live or direct), schema, workspaces

Tracker (read):
  nim tracker ready  [--type T] [--limit N | --all] [--json|--csv|-q]
  nim tracker list   [--type T] [--status open|closed|<s>] [--priority P]
                     [--owner me|<o>] [--since 1d] [--until 2026-06-01]
                     [--where field=value] [--limit N | --all] [--json|--csv|-q]
                     [--inbox]                (still needs a triage decision; live mode)
  nim tracker get    <id|KEY|urn>
  nim tracker show   <id|KEY>            (pretty body render)
  nim tracker types  [show <type>]

Tracker (write — live mode; direct writes refused while the app owns the DB):
  nim tracker create <type> "<title>" [--status S] [--priority P] [--owner O]
                     [--tag T ...] [--field k=v ...] [--body TXT | --body-file F]
                     [--type-tag T ...] [--link-session]
  nim tracker update <id|KEY> [--status S] [--field k=v ...] [--unset f ...] …
  nim tracker comment <id|KEY> "<body>"   (or --body-file F)
  nim tracker archive <id|KEY> / nim tracker unarchive <id|KEY>
  nim tracker link-session <id|KEY> [--session <id>]   (live only)
  nim tracker types define -f <schema.yaml|.json> / nim tracker types rm <type>

Tracker (importers — live mode only):
  nim tracker importers                                  (list installed importers)
  nim tracker import search <providerId> [--repo owner/repo] [--state open|closed|all]
                     [--search TXT] [--limit N]
  nim tracker import <providerId> <externalId> [--type <trackerType>]
  nim tracker import resnapshot <urn>                    (e.g. github://owner/repo#42)

Release (live mode for writes):
  nim release list [--pending] [--json]
  nim release finalize [<id|KEY>] --version X.Y.Z [--tag vX.Y.Z] [--channel alpha|stable]
                     [--date <iso>]        (fills the existing item, flips it to released)
  nim release notes [<id|KEY>] [--json]    (markdown from the release's members)

${wikiHelp()}
Cross-cutting flags:
  --workspace <path>   target workspace (default: resolve from cwd)
  --db <file>          direct mode against an explicit SQLite file
  --live / --offline   force access mode
  --json / --csv       machine output (JSON shape = TrackerRecord)
  --columns a,b,c      table/CSV columns
  --quiet, -q          ids only
  --no-color           disable ANSI color (also honors NO_COLOR)

Exit codes: 0 ok · 1 not found · 2 usage · 3 connection · 4 schema · 5 write-not-permitted
            6 partial write (wiki item written, page text failed; not retryable as-is)
`;

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    return reportError(err);
  }

  if (flagBool(args, 'no-color')) setColorEnabled(false);

  if (flagBool(args, 'version')) {
    process.stdout.write(VERSION + '\n');
    return ExitCode.OK;
  }

  if (!args.noun || flagBool(args, 'help')) {
    process.stdout.write(help());
    return ExitCode.OK;
  }

  try {
    switch (args.noun) {
      case 'tracker':
        return await runTracker(args);
      case 'release':
        return await runRelease(args);
      case 'status':
        return await runStatus(args);
      case 'workspace':
        return await runWorkspace(args);
      case 'session':
        return await runSession(args);
      case 'doc':
        return await runDoc(args);
      case 'login':
        return await runLogin(args);
      case 'logout':
        return await runLogout(args);
      case 'whoami':
        return await runWhoami(args);
      case 'wiki':
        return await runWiki(args);
      default:
        process.stderr.write(`nim: unknown command '${args.noun}'. Run 'nim --help'.\n`);
        return ExitCode.USAGE;
    }
  } catch (err) {
    return reportError(err);
  }
}

function reportError(err: unknown): number {
  // Messages can carry server- or team-written text; strip terminal control sequences.
  if (err instanceof CliError) {
    process.stderr.write(`nim: ${safeText(err.message)}\n`);
    return err.code;
  }
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`nim: ${safeText(message)}\n`);
  if (process.env.NIM_DEBUG && err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  return ExitCode.CONNECTION;
}
