// @vitest-environment node
/**
 * Regression cover for NIM-881 / GitHub #647: an open file truncated to 0 bytes
 * by a sleep/resume crash. Two independent mechanisms produced the same
 * symptom, so both get a test here:
 *
 *   1. `writeFileSync` opens with O_TRUNC, so the target is emptied *before*
 *      the new bytes land. A crash in that window leaves 0 bytes.
 *   2. Nothing in the save chain refused to write empty content over a
 *      non-empty file, so an uninitialized editor buffer could clobber it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  writeFileAtomicSync,
  shouldBlockEmptyOverwrite,
  wouldDiscardUnseenContent,
  writeRecoverySnapshot,
  RECOVERY_SNAPSHOT_INFIX,
} from '../safeFileWrite';

describe('writeFileAtomicSync', () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-atomic-'));
    target = path.join(dir, 'note.md');
    fs.writeFileSync(target, 'original content', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('replaces content and leaves no temp file behind', () => {
    writeFileAtomicSync(target, 'new content');

    expect(fs.readFileSync(target, 'utf-8')).toBe('new content');
    expect(fs.readdirSync(dir)).toEqual(['note.md']);
  });

  it('publishes by rename, so the target is never opened for truncation', () => {
    // This is what makes the crash window survivable: the bytes are assembled
    // in a temp file and swapped in, so the inode behind the path is replaced
    // rather than emptied and refilled. A direct writeFileSync keeps the same
    // inode, which is exactly the state that leaves 0 bytes after a crash.
    const before = fs.statSync(target).ino;

    writeFileAtomicSync(target, 'new content');

    expect(fs.statSync(target).ino).not.toBe(before);
  });

  it('still saves into a read-only directory, where no temp file can be created', () => {
    // Permissions live on the file, not the directory, so a direct write
    // succeeds here. Atomic publishing cannot, and refusing the save outright
    // would be a worse bug than the one being fixed -- so it falls back.
    fs.chmodSync(dir, 0o500);
    try {
      writeFileAtomicSync(target, 'new content');
      expect(fs.readFileSync(target, 'utf-8')).toBe('new content');
    } finally {
      fs.chmodSync(dir, 0o700);
    }
    expect(fs.readdirSync(dir)).toEqual(['note.md']);
  });

  it('preserves the file mode', () => {
    fs.chmodSync(target, 0o640);

    writeFileAtomicSync(target, 'new content');

    expect(fs.statSync(target).mode & 0o777).toBe(0o640);
  });

  it('writes through a symlink instead of replacing it', () => {
    const link = path.join(dir, 'link.md');
    fs.symlinkSync(target, link);

    writeFileAtomicSync(link, 'new content');

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('new content');
  });

  it('creates a file that does not exist yet', () => {
    const fresh = path.join(dir, 'fresh.md');

    writeFileAtomicSync(fresh, 'hello');

    expect(fs.readFileSync(fresh, 'utf-8')).toBe('hello');
  });
});

describe('shouldBlockEmptyOverwrite', () => {
  it('blocks an autosave of empty content over a non-empty file', () => {
    expect(shouldBlockEmptyOverwrite({ content: '', diskContent: '# Notes', source: 'auto' })).toBe(true);
  });

  it('blocks whitespace-only autosaves too', () => {
    // An uninitialized Lexical buffer serializes to a bare newline, not ''.
    expect(shouldBlockEmptyOverwrite({ content: '\n', diskContent: '# Notes', source: 'auto' })).toBe(true);
  });

  it('allows a manual save, so a user can genuinely clear a file', () => {
    expect(shouldBlockEmptyOverwrite({ content: '', diskContent: '# Notes', source: 'manual' })).toBe(false);
  });

  it('allows an autosave when the file on disk is already empty', () => {
    expect(shouldBlockEmptyOverwrite({ content: '', diskContent: '', source: 'auto' })).toBe(false);
  });

  it('allows an autosave with real content', () => {
    expect(shouldBlockEmptyOverwrite({ content: '# Notes', diskContent: '# Old', source: 'auto' })).toBe(false);
  });
});

/**
 * #3684: the same shape as #647 above, one level more general. #647 refused one
 * *value* of wrong buffer (empty); this refuses to lose disk content the writer
 * never demonstrably saw, whatever it contains.
 */
describe('wouldDiscardUnseenContent', () => {
  const seen = { content: 'new', diskContent: 'on disk', lastKnownContent: 'on disk' };

  it('is false when a baseline was supplied -- saveFile already proved disk matches it', () => {
    expect(wouldDiscardUnseenContent(seen)).toBe(false);
  });

  it('is true when no baseline was supplied and disk holds something else', () => {
    expect(wouldDiscardUnseenContent({ ...seen, lastKnownContent: undefined })).toBe(true);
  });

  it('is false when the write is a no-op', () => {
    expect(
      wouldDiscardUnseenContent({ content: 'same', diskContent: 'same', lastKnownContent: undefined }),
    ).toBe(false);
  });

  it('is false when there is nothing on disk worth keeping', () => {
    expect(
      wouldDiscardUnseenContent({ content: 'new', diskContent: '  \n', lastKnownContent: undefined }),
    ).toBe(false);
  });

  it('still fires when the baseline is absent but disk matches nothing the writer holds', () => {
    // The forced-overwrite retry lands here: the user chose to discard external
    // changes, and this is the only copy of what they discarded.
    expect(
      wouldDiscardUnseenContent({
        content: 'my version',
        diskContent: 'their version',
        lastKnownContent: undefined,
      }),
    ).toBe(true);
  });
});

describe('writeRecoverySnapshot', () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-recovery-'));
    target = path.join(dir, 'plan.md');
    fs.writeFileSync(target, 'the agent wrote this', 'utf-8');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the discarded content beside the file and leaves the file alone', () => {
    const snapshot = writeRecoverySnapshot(target, 'the agent wrote this', Date.parse('2026-08-22T18:00:00Z'));

    expect(fs.readFileSync(snapshot, 'utf-8')).toBe('the agent wrote this');
    expect(fs.readFileSync(target, 'utf-8')).toBe('the agent wrote this');
    expect(path.dirname(snapshot)).toBe(dir);
    expect(path.basename(snapshot)).toContain(RECOVERY_SNAPSHOT_INFIX);
  });

  it('does not collide across snapshots of the same file at different times', () => {
    const a = writeRecoverySnapshot(target, 'v1', Date.parse('2026-08-22T18:00:00Z'));
    const b = writeRecoverySnapshot(target, 'v2', Date.parse('2026-08-22T18:00:01Z'));
    expect(a).not.toBe(b);
    expect(fs.readFileSync(a, 'utf-8')).toBe('v1');
    expect(fs.readFileSync(b, 'utf-8')).toBe('v2');
  });
});
