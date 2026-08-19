import { createHash } from 'crypto';

export type CollabFileContent = string | Uint8Array;

export type PullConflictKind =
  | 'missing-baseline'
  | 'local-ahead'
  | 'diverged';

export type PullStateClassification =
  | { status: 'noop'; repairBaselines: boolean }
  | { status: 'safe-pull' }
  | { status: 'conflict'; conflictKind: PullConflictKind };

export interface PullStateInput {
  currentLocalHash: string;
  currentSharedHash: string;
  candidateLocalHash: string;
  baselineLocalHash: string | null;
  baselineSharedHash: string | null;
}

export function hashCollabFileContent(content: CollabFileContent): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Classify a shared-to-local pull without performing side effects.
 *
 * `candidateLocalHash` is the deterministic local representation of the
 * current shared export. It normally equals `currentSharedHash`, but markdown
 * attachment materialization rewrites collab-asset URIs to local paths.
 */
export function classifyPullState(input: PullStateInput): PullStateClassification {
  if (input.currentLocalHash === input.candidateLocalHash) {
    const baselinesAlreadyMatch =
      input.baselineLocalHash === input.currentLocalHash
      && input.baselineSharedHash === input.currentSharedHash;
    return { status: 'noop', repairBaselines: !baselinesAlreadyMatch };
  }

  if (!input.baselineLocalHash || !input.baselineSharedHash) {
    return { status: 'conflict', conflictKind: 'missing-baseline' };
  }

  const localChanged = input.currentLocalHash !== input.baselineLocalHash;
  const sharedChanged = input.currentSharedHash !== input.baselineSharedHash;
  if (!localChanged && !sharedChanged) {
    return { status: 'noop', repairBaselines: false };
  }
  if (!localChanged && sharedChanged) {
    return { status: 'safe-pull' };
  }
  if (localChanged && !sharedChanged) {
    return { status: 'conflict', conflictKind: 'local-ahead' };
  }
  return { status: 'conflict', conflictKind: 'diverged' };
}
