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
import { writeFileAtomicSync, shouldBlockEmptyOverwrite } from '../safeFileWrite';

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
