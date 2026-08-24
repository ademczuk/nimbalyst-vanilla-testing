import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The full Vitest suite currently has Windows-nonportable failures. Keep it
 * mandatory everywhere else, including Windows CI, while local Windows pushes
 * retain the typecheck and focused-test gates.
 */
export function shouldRunFullPrePushSuite({ platform = process.platform, ci = process.env.CI } = {}) {
  return platform !== 'win32' || /^(1|true|yes)$/i.test(ci ?? '');
}

function runGit(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

const ZERO_SHA = /^0+$/;

/**
 * Git hands pre-push one line per ref: "<localRef> <localSha> <remoteRef> <remoteSha>".
 *
 * A release pushes `main` and then the tag on the same commit, and the hook used to
 * ignore stdin and re-gate HEAD both times -- the second run re-validated a tree the
 * first had just proven. Ask Git which commits the push actually delivers instead of
 * assuming they are new.
 *
 * Conservative by construction: anything unexpected (no refs, a failing git) returns
 * true, so a push is never waved through un-gated.
 */
export function pushDeliversNewCommits({ stdin = '', remote = 'origin', git = runGit } = {}) {
  if (stdin.trim() === '') return true;

  const shas = stdin
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[1])
    .filter((sha) => sha && !ZERO_SHA.test(sha));

  // Every ref was a deletion; a deletion carries no commits to test.
  if (shas.length === 0) return false;

  try {
    const count = git('rev-list', '--count', ...shas, '--not', `--remotes=${remote}`);
    return Number.parseInt(count.trim(), 10) > 0;
  } catch {
    return true;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [flag, remote] = process.argv.slice(2);
  if (flag === '--delivers') {
    const stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
    process.stdout.write(pushDeliversNewCommits({ stdin, remote: remote || 'origin' }) ? 'new\n' : 'none\n');
  } else {
    process.stdout.write(shouldRunFullPrePushSuite() ? 'run\n' : 'skip\n');
  }
}
