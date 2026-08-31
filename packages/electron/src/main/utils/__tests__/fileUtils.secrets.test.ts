// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  deleteSecretFile,
  legacySecretFileName,
  readSecretFile,
  secretFileName,
  writeSecretFile,
} from '../fileUtils';

/**
 * #1408: scoped secret keys look like `nimbalyst:<extensionId>:<key>`. The old
 * sanitiser kept the colons, and on NTFS `a:b:c` is Alternate Data Stream
 * syntax, so every write failed with ENOENT and every read silently looked
 * like "no secret stored". No Windows machine is available to us, so these
 * filename properties are the gate.
 */
describe('secretFileName', () => {
  const scoped = (key: string) => `nimbalyst:com_example_ext:${key}`;

  it('never emits a character Windows rejects in a filename', () => {
    const name = secretFileName(scoped('apiKey'));
    expect(name).not.toMatch(/[:<>"|?*\\/]/);
  });

  it('is deterministic', () => {
    expect(secretFileName(scoped('apiKey'))).toBe(secretFileName(scoped('apiKey')));
  });

  it('separates keys the old sanitiser collapsed onto one file', () => {
    // Both sanitise to the same stem; only the hash of the original key keeps
    // them apart, so two extensions no longer share one secret.
    expect(secretFileName(scoped('a.b'))).not.toBe(secretFileName(scoped('a_b')));
  });

  it('separates keys that differ only by case', () => {
    // Windows and default macOS are case-insensitive, so a stem-only
    // difference is not a difference at all.
    const upper = secretFileName(scoped('apiKey')).toLowerCase();
    const lower = secretFileName(scoped('apikey')).toLowerCase();
    expect(upper).not.toBe(lower);
  });

  it('does not produce a reserved Windows device name as the stem', () => {
    // Windows reserves CON/NUL/COM1 only as the exact stem: `CON.enc` is
    // reserved, `CON-a1b2c3d4.enc` is not.
    for (const reserved of ['CON', 'NUL', 'PRN', 'AUX', 'COM1', 'LPT1']) {
      const stem = secretFileName(reserved).split('.')[0];
      expect(stem).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i);
    }
  });

  it('bounds the filename so a long key cannot push a Windows path past MAX_PATH', () => {
    const pathological = scoped('k'.repeat(500));
    // The extension-secrets directory under AppData\Roaming already costs
    // roughly 70 characters of the 260 Windows allows.
    expect(secretFileName(pathological).length).toBeLessThanOrEqual(100);
  });

  it('still distinguishes long keys that share a truncated prefix', () => {
    const prefix = 'k'.repeat(500);
    expect(secretFileName(scoped(`${prefix}one`))).not.toBe(secretFileName(scoped(`${prefix}two`)));
  });
});

describe('legacySecretFileName', () => {
  it('reproduces the pre-fix filename so already-stored secrets stay findable', () => {
    // This exact name exists on macOS installs today, written by the bundled
    // image-generation extension. If this assertion changes, those secrets are
    // orphaned.
    expect(legacySecretFileName('nimbalyst:com.nimbalyst.image-generation:google_ai_api_key')).toBe(
      'nimbalyst:com_nimbalyst_image-generation:google_ai_api_key.enc'
    );
  });
});

describe('secret file storage', () => {
  const KEY = 'nimbalyst:com_example_ext:apiKey';
  const plain = (data: Buffer) => data.toString('utf8');
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nimbalyst-secrets-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeLegacy = (value: string) =>
    writeFileSync(join(dir, legacySecretFileName(KEY)), value, 'utf8');

  it('round-trips a secret through the current scheme', () => {
    writeSecretFile(dir, KEY, 'sk-live');
    expect(readSecretFile(dir, KEY, plain)).toBe('sk-live');
  });

  it('returns null when no secret is stored', () => {
    expect(readSecretFile(dir, KEY, plain)).toBeNull();
  });

  it('reads a secret stored under the legacy name', () => {
    writeLegacy('sk-legacy');
    expect(readSecretFile(dir, KEY, plain)).toBe('sk-legacy');
  });

  it('copies a legacy secret forward without removing the original', () => {
    writeLegacy('sk-legacy');
    readSecretFile(dir, KEY, plain);

    expect(existsSync(join(dir, secretFileName(KEY)))).toBe(true);
    // Copy, never rename: the original stays put as the recoverable artifact.
    expect(existsSync(join(dir, legacySecretFileName(KEY)))).toBe(true);
    expect(readFileSync(join(dir, secretFileName(KEY)), 'utf8')).toBe('sk-legacy');
  });

  it('does not adopt a legacy file whose contents will not decrypt', () => {
    writeLegacy('corrupt');
    const decryptFails = () => {
      throw new Error('decrypt failed');
    };

    expect(() => readSecretFile(dir, KEY, decryptFails)).toThrow('decrypt failed');
    expect(existsSync(join(dir, secretFileName(KEY)))).toBe(false);
  });

  it('prefers the current scheme over a stale legacy file', () => {
    writeLegacy('sk-stale');
    writeSecretFile(dir, KEY, 'sk-current');
    expect(readSecretFile(dir, KEY, plain)).toBe('sk-current');
  });

  it('removes a superseded legacy file once the new write has landed', () => {
    writeLegacy('sk-stale');
    writeSecretFile(dir, KEY, 'sk-current');

    // The old credential is superseded, so leaving it decryptable on disk is
    // the worse outcome.
    expect(existsSync(join(dir, legacySecretFileName(KEY)))).toBe(false);
  });

  it('keeps the legacy file when the new write fails', () => {
    writeLegacy('sk-stale');
    // A directory sitting where the new file belongs makes writeFileSync throw,
    // so the write fails in the same directory the legacy file lives in.
    mkdirSync(join(dir, secretFileName(KEY)));

    expect(() => writeSecretFile(dir, KEY, 'sk-current')).toThrow();
    // A failed write must never leave the only remaining copy destroyed.
    expect(existsSync(join(dir, legacySecretFileName(KEY)))).toBe(true);
    expect(readFileSync(join(dir, legacySecretFileName(KEY)), 'utf8')).toBe('sk-stale');
  });

  it('deletes both names so no decryptable copy survives', () => {
    writeSecretFile(dir, KEY, 'sk-current');
    writeLegacy('sk-legacy');

    deleteSecretFile(dir, KEY);

    expect(existsSync(join(dir, secretFileName(KEY)))).toBe(false);
    expect(existsSync(join(dir, legacySecretFileName(KEY)))).toBe(false);
  });

  it('is a no-op when deleting a key that was never stored', () => {
    expect(() => deleteSecretFile(dir, KEY)).not.toThrow();
  });
});
