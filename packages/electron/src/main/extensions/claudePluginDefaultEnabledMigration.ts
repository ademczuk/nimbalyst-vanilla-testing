/**
 * One-time migration for the Claude plugin loader starting to honor a
 * manifest's `defaultEnabled: false`.
 *
 * Before this, the loader ignored `defaultEnabled`, so an extension that never
 * had its enabled state stored still contributed its skills and commands to
 * agent sessions (while Settings showed it as off). Honoring the default would
 * silently take those skills away from anyone relying on them, so on the first
 * launch with the fix we pin `enabled: true` for every such extension that was
 * already loading.
 *
 * "Already loading" is read from the user extensions directory: anything on
 * disk there when this runs was installed by a previous build, because the
 * migration runs before the new build can install anything. Built-in
 * extensions are excluded on purpose -- they ship with the build, so the
 * directory cannot tell an older built-in from one first shipped in this
 * build, and the manifest default is authoritative for them. At the time of
 * this change no built-in combined `defaultEnabled: false` with a Claude plugin
 * except the one this fix is for.
 *
 * Until the migration has succeeded, the loaders keep the legacy behavior for
 * the user extensions directory (see `ensureClaudePluginDefaultEnabledMigration`),
 * so a failed attempt never drops skills before they are pinned.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import {
  getClaudePluginDefaultEnabledMigrationVersion,
  getExtensionSettings,
  setClaudePluginDefaultEnabledMigrationVersion,
  setExtensionEnabled,
  type ExtensionSettings,
} from '../utils/store';

export const CLAUDE_PLUGIN_DEFAULT_ENABLED_MIGRATION_VERSION = 1;

export interface InstalledExtensionFacts {
  extensionId: string;
  defaultEnabled?: boolean;
  hasClaudePlugin: boolean;
}

export interface MigrationStore {
  getVersion(): number;
  setVersion(version: number): void;
  getSettings(): Record<string, ExtensionSettings>;
  setEnabled(extensionId: string, enabled: boolean): void;
}

// Accessors are read at call time, not import time, so importing this module
// (via ExtensionHandlers) never touches the store. Any store failure surfaces
// as a rejected migration, which the gate turns into legacy behavior.
const appMigrationStore: MigrationStore = {
  getVersion: () => getClaudePluginDefaultEnabledMigrationVersion(),
  setVersion: (version) => setClaudePluginDefaultEnabledMigrationVersion(version),
  getSettings: () => getExtensionSettings(),
  setEnabled: (extensionId, enabled) => setExtensionEnabled(extensionId, enabled),
};

/** Extension ids whose current effective state must be pinned to enabled. */
export function planClaudePluginDefaultEnabledMigration(
  installed: InstalledExtensionFacts[],
  settings: Record<string, ExtensionSettings>
): string[] {
  return installed
    .filter((ext) =>
      ext.defaultEnabled === false &&
      ext.hasClaudePlugin &&
      settings[ext.extensionId]?.enabled === undefined
    )
    .map((ext) => ext.extensionId);
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/**
 * Read the facts for every extension in the directory. Only a missing
 * directory or a missing manifest means "nothing was loading"; any other read
 * or parse failure throws so the migration is retried instead of recorded.
 */
async function readInstalledExtensionFacts(extensionsDir: string): Promise<InstalledExtensionFacts[]> {
  let entries;
  try {
    entries = await fs.readdir(extensionsDir, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const facts: InstalledExtensionFacts[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    let content: string;
    try {
      content = await fs.readFile(path.join(extensionsDir, entry.name, 'manifest.json'), 'utf-8');
    } catch (error) {
      if (isNotFound(error)) continue;
      throw error;
    }
    const manifest = JSON.parse(content);
    facts.push({
      extensionId: manifest.id || entry.name,
      defaultEnabled: manifest.defaultEnabled,
      hasClaudePlugin: Boolean(manifest.contributions?.claudePlugin?.path),
    });
  }
  return facts;
}

/**
 * Apply the migration once per profile. Returns the ids it pinned (empty when
 * already applied) and throws on any operational failure, leaving the version
 * unrecorded so the next attempt re-plans. Pins written before a failure are
 * stored values, so a retry skips them rather than duplicating them.
 */
export async function runClaudePluginDefaultEnabledMigration(
  userExtensionsDir: string,
  store: MigrationStore = appMigrationStore
): Promise<string[]> {
  if (store.getVersion() >= CLAUDE_PLUGIN_DEFAULT_ENABLED_MIGRATION_VERSION) {
    return [];
  }
  const pinned = planClaudePluginDefaultEnabledMigration(
    await readInstalledExtensionFacts(userExtensionsDir),
    store.getSettings()
  );
  for (const extensionId of pinned) {
    store.setEnabled(extensionId, true);
  }
  store.setVersion(CLAUDE_PLUGIN_DEFAULT_ENABLED_MIGRATION_VERSION);
  if (pinned.length > 0) {
    logger.main.info('[ExtensionHandlers] Kept Claude plugins enabled for previously loaded extensions:', pinned);
  }
  return pinned;
}

/**
 * Single-flight gate: concurrent callers share one attempt, a success is
 * remembered for the process, and a failure is forgotten so the next call
 * retries. Resolves to whether the migration has been applied.
 */
export function createMigrationGate(run: () => Promise<unknown>): () => Promise<boolean> {
  let inFlight: Promise<boolean> | null = null;
  let succeeded = false;
  return () => {
    if (succeeded) return Promise.resolve(true);
    inFlight ??= Promise.resolve().then(run).then(
      () => {
        succeeded = true;
        inFlight = null;
        return true;
      },
      (error) => {
        logger.main.error('[ExtensionHandlers] Claude plugin defaultEnabled migration failed; will retry:', error);
        inFlight = null;
        return false;
      }
    );
    return inFlight;
  };
}

let appGate: (() => Promise<boolean>) | null = null;
let appGateDir: string | null = null;

/**
 * Run the migration before a plugin scan reads enabled state. When this
 * resolves false, callers must ignore `defaultEnabled` for the user extensions
 * directory (legacy behavior) so nothing is dropped before it is pinned.
 */
export function ensureClaudePluginDefaultEnabledMigration(userExtensionsDir: string): Promise<boolean> {
  if (!appGate || appGateDir !== userExtensionsDir) {
    appGateDir = userExtensionsDir;
    appGate = createMigrationGate(() => runClaudePluginDefaultEnabledMigration(userExtensionsDir));
  }
  return appGate();
}
