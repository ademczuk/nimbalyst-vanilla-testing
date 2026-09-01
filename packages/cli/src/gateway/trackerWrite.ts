/**
 * CLI host helpers for offline (direct-mode) tracker mutations.
 *
 * These stay in the CLI because identity lookup uses Node's git process and the
 * mutation transaction belongs to DirectGateway, not the pure tracker package.
 *   - `getCurrentIdentity` — copy of the git-config branch of
 *     packages/electron/src/main/services/TrackerIdentityService.ts. The app
 *     also checks Stytch auth first, but Stytch state only exists inside the
 *     running app; an offline CLI has no app session, so we resolve identity
 *     from git config (then anonymous), which is exactly the app's fallback.
 * The remaining helpers shape CLI-only ids and comments at the host boundary.
 *
 * `appendActivity` is deliberately NOT one of them: a CLI-written row has to be
 * byte-for-byte what the app writes, and two copies of that rule had already
 * drifted, so it is re-exported from the shared package rather than restated.
 */
import { execSync } from 'child_process';
import type { TrackerIdentity } from '@nimbalyst/tracker-core';
export {
  appendActivity,
  humanOnlyStatusMessage,
  isHumanOnlyStatus,
} from '@nimbalyst/tracker-core';
export type { TrackerIdentity } from '@nimbalyst/tracker-core';

function getGitUserConfig(workspacePath?: string): { gitName: string | null; gitEmail: string | null } {
  const cwd = workspacePath || process.cwd();
  let gitName: string | null = null;
  let gitEmail: string | null = null;
  try {
    gitName = execSync('git config user.name', { cwd, stdio: 'pipe' }).toString().trim() || null;
  } catch {
    /* git not configured or not a git repo */
  }
  try {
    gitEmail = execSync('git config user.email', { cwd, stdio: 'pipe' }).toString().trim() || null;
  } catch {
    /* git not configured or not a git repo */
  }
  return { gitName, gitEmail };
}

/**
 * Resolve the current user's identity for offline authorship. Mirrors the app's
 * priority chain minus Stytch (unavailable offline): git config, then anonymous.
 */
export function getCurrentIdentity(workspacePath?: string): TrackerIdentity {
  const { gitName, gitEmail } = getGitUserConfig(workspacePath);
  if (gitEmail || gitName) {
    return {
      email: gitEmail,
      displayName: gitName || gitEmail || 'Local User',
      gitName,
      gitEmail,
    };
  }
  return { email: null, displayName: 'Local User', gitName: null, gitEmail: null };
}

/** The comment shape pushed by `handleTrackerAddComment`. */
export function buildComment(authorIdentity: TrackerIdentity, body: string): {
  id: string;
  authorIdentity: TrackerIdentity;
  body: string;
  createdAt: number;
  updatedAt: null;
  deleted: false;
} {
  return {
    id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    authorIdentity,
    body,
    createdAt: Date.now(),
    updatedAt: null,
    deleted: false,
  };
}

/** Allocate a fresh native tracker id, matching the handler's scheme. */
export function newTrackerId(type: string): string {
  return `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
