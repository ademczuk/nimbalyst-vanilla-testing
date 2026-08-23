/**
 * The two guards that stand between an editor buffer and a user's file.
 *
 * GitHub #647: a Mac sleep/resume crash left the open file at 0 bytes,
 * recoverable only from git. Two mechanisms produced that, and either one is
 * sufficient on its own, so both are closed here:
 *
 *   1. `writeFileSync` opens the target with O_TRUNC. The file is empty from
 *      the moment the call starts until the last byte lands, so a crash in
 *      that window destroys the file. `writeFileAtomicSync` moves that window
 *      onto a temp file and publishes with `rename`, which is atomic on the
 *      same filesystem.
 *   2. Nothing refused to write empty content over a non-empty file. If the
 *      editor handed back an uninitialized (empty) buffer, the conflict check
 *      one layer up still passed -- disk matched last-known -- and the write
 *      cleanly produced 0 bytes. `shouldBlockEmptyOverwrite` refuses that for
 *      autosaves while leaving a deliberate manual save alone.
 *
 * Deliberately free of electron imports so it stays cheap to test.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FileSaveSource } from '../ipc/fileSaveErrors';

/**
 * Marks the scratch file an atomic write publishes from. It lands inside the
 * user's workspace (the rename has to stay on one filesystem), so the
 * workspace watcher has to know to ignore it — otherwise every autosave emits
 * an add/unlink pair and churns the file tree. See `shouldIgnoreHardcoded` in
 * WorkspaceEventBus.ts.
 */
export const ATOMIC_WRITE_TEMP_SUFFIX = '.nimbalyst-tmp';

/**
 * Write `content` to `filePath` without ever leaving the target truncated.
 *
 * Symlinks are resolved first: renaming over a link would replace the link
 * itself, silently detaching the user's file from the path they edit through.
 * The temp file is created alongside the target so the rename stays on one
 * filesystem, and it is removed on every failure path.
 */
export function writeFileAtomicSync(filePath: string, content: string): void {
  let target = filePath;
  try {
    target = fs.realpathSync(filePath);
  } catch {
    // New file, or a broken link. Write to the path as given.
  }

  let mode: number | undefined;
  try {
    mode = fs.statSync(target).mode & 0o777;
  } catch {
    // No existing file to inherit permissions from; let the umask decide.
  }

  const dir = path.dirname(target);
  const tempPath = path.join(
    dir,
    `.${path.basename(target)}.${process.pid}.${Date.now()}${ATOMIC_WRITE_TEMP_SUFFIX}`,
  );

  let handle: number | undefined;
  try {
    handle = fs.openSync(tempPath, 'w', mode ?? 0o666);
    fs.writeFileSync(handle, content, 'utf-8');
    // Force the bytes out before publishing. Without this the rename can be
    // durable while the contents are not, which is the same 0-byte file by a
    // slower route.
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;

    if (mode !== undefined) fs.chmodSync(tempPath, mode);
    fs.renameSync(tempPath, target);
  } catch (error) {
    if (handle !== undefined) {
      try { fs.closeSync(handle); } catch { /* already closed */ }
    }
    try { fs.unlinkSync(tempPath); } catch { /* nothing to clean up */ }

    // A directory we cannot create a temp file in still permits writing an
    // existing file, because permission lives on the file. Refusing the save
    // would strand the user's edits over a hazard that only exists during a
    // crash, so fall back to the direct write for this narrow case only.
    if (isDirectoryNotWritable(error) && fs.existsSync(target)) {
      fs.writeFileSync(target, content, 'utf-8');
      return;
    }
    throw error;
  }
}

function isDirectoryNotWritable(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
}

export interface EmptyOverwriteCheck {
  /** Content the editor wants to persist. */
  content: string;
  /** Content currently on disk. */
  diskContent: string;
  /** Whether this came from autosave or a deliberate user action. */
  source: FileSaveSource;
}

/**
 * True when this write would empty a non-empty file without the user asking.
 *
 * Only autosaves are refused. A manual save is the user saying "yes, this file
 * is empty now", and refusing it would be a bug of its own -- there would be no
 * way to clear a file. Autosave has no such intent behind it, so an empty
 * buffer arriving there is far more likely to be uninitialized editor state
 * than a real edit.
 *
 * Whitespace-only counts as empty: a Lexical editor that never finished
 * mounting serializes to a bare newline rather than an empty string.
 */
export function shouldBlockEmptyOverwrite({ content, diskContent, source }: EmptyOverwriteCheck): boolean {
  if (source !== 'auto') return false;
  if (content.trim().length > 0) return false;
  return diskContent.trim().length > 0;
}

/** Marks a snapshot of content a write was about to destroy. */
export const RECOVERY_SNAPSHOT_INFIX = '.nimbalyst-discarded-';

export interface DiscardRiskCheck {
  content: string;
  diskContent: string;
  /**
   * The conflict baseline the caller supplied. `undefined` means the write
   * asked for the conflict check to be skipped, so nothing verified that the
   * writer had ever seen what is currently on disk.
   */
  lastKnownContent: string | undefined;
}

/**
 * True when a write is about to destroy disk content the writer never
 * demonstrably saw.
 *
 * With a baseline present, `saveFile` has already proved disk matches it, so
 * the writer is up to date and nothing is silently lost. Without one, the
 * write is an unconditional overwrite -- a forced conflict resolution, or a
 * caller that omitted the argument. #3684 was three callers in the second
 * category. Snapshotting first is the "leave a recoverable artifact"
 * requirement in .claude/rules/destructive-data-paths.md: we may still be
 * wrong about which side is right, and the user has no other copy.
 */
export function wouldDiscardUnseenContent({
  content,
  diskContent,
  lastKnownContent,
}: DiscardRiskCheck): boolean {
  if (lastKnownContent !== undefined) return false;
  if (diskContent.trim().length === 0) return false;
  return diskContent !== content;
}

/**
 * Persist `diskContent` beside the file before it is overwritten, and return
 * the snapshot path. Best effort: a failure here must never block the write
 * the user asked for, so callers log and continue.
 *
 * The snapshot sits next to the file rather than in a hidden cache so the user
 * can actually find it, and carries the atomic-write temp suffix's sibling
 * treatment in the workspace watcher's ignore list.
 */
export function writeRecoverySnapshot(filePath: string, diskContent: string, now: number): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(dir, `${base}${RECOVERY_SNAPSHOT_INFIX}${stamp}`);
  fs.writeFileSync(snapshotPath, diskContent, 'utf-8');
  return snapshotPath;
}
