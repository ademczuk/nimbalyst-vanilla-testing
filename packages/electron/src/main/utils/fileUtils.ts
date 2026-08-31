/**
 * File system utilities for the main process.
 */

import { copyFileSync, existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';

export interface GetAllFilesOptions {
  /**
   * Base path to make paths relative to.
   * If provided, returned paths will be relative to this path.
   * If not provided, returned paths will be absolute.
   */
  basePath?: string;
  /**
   * If true, normalize path separators to forward slashes.
   * Useful for git compatibility on Windows.
   * Default: false
   */
  normalizeSlashes?: boolean;
}

/**
 * Recursively get all files within a directory.
 * Used to expand directories into individual file paths.
 *
 * @param dirPath Absolute path to the directory
 * @param options Options for path handling
 * @returns Array of file paths within the directory
 */
export function getAllFilesInDirectory(dirPath: string, options: GetAllFilesOptions = {}): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively get files from subdirectories
        files.push(...getAllFilesInDirectory(fullPath, options));
      } else if (entry.isFile()) {
        let resultPath: string;

        if (options.basePath) {
          // Return relative path from base
          resultPath = relative(options.basePath, fullPath);
        } else {
          // Return absolute path
          resultPath = fullPath;
        }

        // Normalize slashes if requested (for git compatibility)
        if (options.normalizeSlashes) {
          resultPath = resultPath.replace(/\\/g, '/');
        }

        files.push(resultPath);
      }
    }
  } catch (error) {
    // If we can't read the directory, skip it
    // Log at debug level since this can happen for permission issues on normal directories
    console.error('[fileUtils] Error reading directory:', dirPath, error);
  }

  return files;
}

/**
 * Longest sanitised stem kept before the disambiguating hash. The
 * extension-secrets directory under AppData\Roaming already costs roughly 70
 * of the 260 characters Windows allows in a path, so the filename is bounded.
 */
const MAX_SECRET_STEM_LENGTH = 80;

/**
 * Filename for a stored secret.
 *
 * Secret keys are scoped by the host as `nimbalyst:<extensionId>:<key>`, so
 * the sanitiser has to survive characters the caller cannot control. Colons in
 * particular are Alternate Data Stream syntax on NTFS, which made every write
 * on Windows fail with ENOENT (#1408).
 *
 * The hash of the original key is not decoration: it keeps keys apart that the
 * sanitiser would otherwise collapse onto one file (`a.b` and `a_b`), keys that
 * differ only by case (identical on Windows and default macOS), and keys long
 * enough that the stem has to be truncated.
 */
export function secretFileName(key: string): string {
  const stem = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_SECRET_STEM_LENGTH);
  const digest = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 8);
  return `${stem}-${digest}.enc`;
}

/**
 * Filename a secret was stored under before #1408.
 *
 * Reproduces the old sanitiser exactly, colons and all. It exists so a read can
 * still find secrets written by earlier versions on macOS and Linux; changing it
 * orphans them, and an orphaned secret reads back as "no secret stored".
 */
export function legacySecretFileName(key: string): string {
  return `${key.replace(/[^a-zA-Z0-9_:-]/g, '_')}.enc`;
}

/**
 * Read a stored secret, falling back to the pre-#1408 filename.
 *
 * A legacy file is copied forward only after `decrypt` has succeeded, so a
 * corrupt file is never propagated under the new name. The copy is best-effort
 * and the original is never renamed or removed, leaving it recoverable.
 *
 * @param decrypt Turns stored bytes into the secret. Injected so this stays
 *   independent of Electron's safeStorage.
 * @returns The secret, or null if no file exists under either name.
 */
export function readSecretFile(
  dirPath: string,
  key: string,
  decrypt: (data: Buffer) => string
): string | null {
  const currentPath = join(dirPath, secretFileName(key));
  const legacyPath = join(dirPath, legacySecretFileName(key));

  const isLegacy = !existsSync(currentPath);
  const sourcePath = isLegacy ? legacyPath : currentPath;
  if (isLegacy && !existsSync(legacyPath)) {
    return null;
  }

  const secret = decrypt(readFileSync(sourcePath));

  if (isLegacy) {
    try {
      copyFileSync(legacyPath, currentPath);
    } catch (error) {
      // The secret was still read successfully, so a failed copy must not fail
      // the call; the next read simply falls back again.
      console.error('[fileUtils] Failed to adopt legacy secret file:', legacyPath, error);
    }
  }

  return secret;
}

/**
 * Write a secret under the current filename.
 *
 * Once the new file is confirmed on disk, any file under the legacy name holds
 * a superseded credential, so it is removed. Verifying first means a failed
 * write can never destroy the only copy.
 */
export function writeSecretFile(dirPath: string, key: string, data: Buffer | string): void {
  const currentPath = join(dirPath, secretFileName(key));
  writeFileSync(currentPath, data);

  const legacyPath = join(dirPath, legacySecretFileName(key));
  if (!existsSync(currentPath) || !existsSync(legacyPath)) {
    return;
  }

  try {
    unlinkSync(legacyPath);
  } catch (error) {
    console.error('[fileUtils] Failed to remove superseded legacy secret file:', legacyPath, error);
  }
}

/**
 * Delete a stored secret under both the current and legacy filenames.
 *
 * Both, because the caller asked for the credential to be gone and leaving a
 * decryptable copy behind would be the worse failure.
 */
export function deleteSecretFile(dirPath: string, key: string): void {
  for (const filePath of [join(dirPath, secretFileName(key)), join(dirPath, legacySecretFileName(key))]) {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}
