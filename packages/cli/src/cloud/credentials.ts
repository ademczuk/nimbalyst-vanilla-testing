/**
 * Token storage for `nim login`: a JSON file readable only by the owner, keyed
 * by server so a staging login never shadows production. The CLI has no OS
 * keychain integration and takes no dependency to add one.
 *
 * Tokens never go through a logger. Identity comes from `/oauth/userinfo`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { connectionError, usageError } from '../cli/exitCodes.js';
import { resolveConfigDir } from './config.js';

export interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms; absent when the server did not say. */
  expiresAt?: number;
}

interface CredentialsFile {
  servers: Record<string, StoredCredentials>;
}

export function credentialsPath(): string {
  return path.join(resolveConfigDir(), 'credentials.json');
}

/**
 * Only a missing file means "logged out". A file we cannot read or parse may
 * hold other servers' tokens, so it is an error: a save that treated it as
 * empty would overwrite them.
 */
function readFile(): CredentialsFile {
  const file = credentialsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { servers: {} };
    throw usageError(`Cannot read ${file}: ${err?.message ?? err}. Fix its permissions, or move it aside and run 'nim login'.`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    throw usageError(`${file} is not valid JSON (${err?.message ?? err}). Move it aside and run 'nim login'.`);
  }
  if (!parsed || typeof parsed.servers !== 'object' || !parsed.servers || Array.isArray(parsed.servers)) {
    throw usageError(`${file} has no "servers" object. Move it aside and run 'nim login'.`);
  }
  return parsed as CredentialsFile;
}

/**
 * `mkdir`'s mode only applies to a directory it creates, so an existing config
 * dir left group- or world-readable is tightened here as well.
 */
function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  if ((fs.statSync(dir).mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700);
}

function writeFile(data: CredentialsFile): void {
  const file = credentialsPath();
  ensurePrivateDir(path.dirname(file));
  // Write a sibling and rename so a crash never leaves half a token file, and
  // create it 0600 so there is no window where it is world-readable.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export function loadCredentials(server: string): StoredCredentials | undefined {
  return readFile().servers[server];
}

/**
 * Read-modify-write under the lock: an unlocked save could land between a
 * refresh's read and its write and be overwritten, or overwrite the rotated
 * refresh token and leave only a spent one on disk.
 */
export function saveCredentials(server: string, creds: StoredCredentials): Promise<void> {
  return withCredentialsLock(async () => {
    const data = readFile();
    data.servers[server] = creds;
    writeFile(data);
  });
}

/** Returns whether anything was removed. */
export function clearCredentials(server: string): Promise<boolean> {
  return withCredentialsLock(async () => {
    const data = readFile();
    if (!data.servers[server]) return false;
    delete data.servers[server];
    writeFile(data);
    return true;
  });
}

const LOCK_STALE_MS = 30_000;
const heldLock = new AsyncLocalStorage<true>();
const LOCK_POLL_MS = 25;
/**
 * How long to wait for the lock before giving up. Longer than the stale window,
 * so a lock left by a dead process is always taken over first; a live holder
 * past this is stuck, and waiting forever would hang a Stop hook.
 * `NIM_CREDENTIALS_LOCK_TIMEOUT_MS` overrides it (tests).
 */
const LOCK_TIMEOUT_MS = 45_000;

function lockTimeoutMs(): number {
  const n = Number(process.env.NIM_CREDENTIALS_LOCK_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : LOCK_TIMEOUT_MS;
}

/** Tolerance for "dated in the future": a fresh file's mtime can lead `Date.now()` by a fraction of a millisecond. */
const LOCK_FUTURE_SKEW_MS = 2_000;

/** Older than the stale window, or dated in the future (a clock change, or a forged file). */
function isStale(mtimeMs: number): boolean {
  const age = Date.now() - mtimeMs;
  return age > LOCK_STALE_MS || age < -LOCK_FUTURE_SKEW_MS;
}

/**
 * Removes a stale lock without ever deleting a fresh one. Unlinking by path
 * after a stat can delete a lock another process created in between, so the
 * lock is first renamed to a name only we know (atomic), then judged. If what
 * we moved turns out to be fresh, it is put back with `link`, which fails
 * rather than overwrite if someone has taken the path meanwhile.
 */
function takeOverIfStale(lock: string, owner: string): void {
  try {
    if (!isStale(fs.statSync(lock).mtimeMs)) return;
  } catch {
    return; // released between our attempt and the stat
  }
  const moved = `${lock}.stale-${owner.replace(/[^\w.-]/g, '_')}`;
  try {
    fs.renameSync(lock, moved);
  } catch {
    return; // someone else moved or released it first
  }
  try {
    if (!isStale(fs.statSync(moved).mtimeMs)) {
      try {
        fs.linkSync(moved, lock);
      } catch {
        // The path was retaken; the lock we moved lost its place either way.
      }
    }
  } finally {
    try {
      fs.unlinkSync(moved);
    } catch {
      // already gone
    }
  }
}

/**
 * Runs `fn` holding an exclusive lock next to the credentials file. Refresh
 * tokens are single-use and a reused one revokes the whole family, so two `nim`
 * processes (a Stop hook and a manual command) must not refresh at once. A lock
 * older than 30 seconds belongs to a process that died and is taken over; a
 * lock still held after the deadline fails the command.
 */
export async function withCredentialsLock<T>(fn: () => Promise<T>): Promise<T> {
  // Re-entrant within one async call chain (a refresh saves while holding the
  // lock), but not across chains: two commands in one process still serialize.
  if (heldLock.getStore()) return fn();
  const lock = `${credentialsPath()}.lock`;
  ensurePrivateDir(path.dirname(lock));
  const owner = `${process.pid}:${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + lockTimeoutMs();
  for (;;) {
    try {
      fs.writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 });
      break;
    } catch (err: any) {
      if (err?.code !== 'EEXIST') throw err;
      takeOverIfStale(lock, owner);
      if (Date.now() > deadline) {
        throw connectionError(`Another nim process has held ${lock} for too long. Try again; if no nim is running, remove that file.`);
      }
      await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
    }
  }
  try {
    return await heldLock.run(true, fn);
  } finally {
    try {
      // Only remove our own lock: after a stale takeover it may belong to someone else.
      if (fs.readFileSync(lock, 'utf8') === owner) fs.unlinkSync(lock);
    } catch {
      // Already gone.
    }
  }
}
