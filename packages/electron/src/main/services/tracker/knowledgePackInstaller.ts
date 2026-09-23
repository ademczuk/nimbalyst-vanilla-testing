/**
 * Installs a knowledge pack into a workspace (knowledge-scopes master plan N11).
 *
 * The installer owns no schema machinery of its own. It routes a pack's types
 * through `upsertWorkspaceTrackerSchema` -- the same path `tracker_define_type`
 * takes -- so the destructive-change gate, the YAML backup, the DB mirror and
 * the team write-back all apply exactly as they do to a hand-authored type. A
 * pack that needed its own write path would be a second schema pipeline, and
 * the first thing to diverge would be the gate.
 *
 * Installing is therefore idempotent in the only sense that matters: it is safe
 * to re-run, and it refuses rather than clobbers when a type of the same name
 * already exists and the caller has not said to replace it.
 */

import { getKnowledgePack, type KnowledgePack } from './packs/knowledgePacks';
import {
  parsePredicateRegistryYAML,
  type PredicateDefinition,
} from '@nimbalyst/tracker-schema';
import {
  upsertWorkspaceTrackerSchema,
  getWorkspaceTrackerSchemaOverride,
  refreshWorkspaceSchemasIfCurrent,
  reloadWorkspacePredicateRegistry,
  TrackerTypeExistsError,
} from '../TrackerSchemaService';
import {
  readWorkspacePredicateRegistry,
  writeWorkspacePredicateRegistry,
} from './trackerPredicateRegistryFile';
import { logger } from '../../utils/logger';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

export interface KnowledgePackInstallResult {
  packId: string;
  /** Types written by this run. */
  installed: string[];
  /** Types already present and left alone (only when `replaceExisting` is false). */
  skipped: string[];
  /** Predicate ids added to the project's registry by this run. */
  predicatesAdded: string[];
  /**
   * Predicate ids the pack declares that the project already had under a
   * DIFFERENT definition. Reported rather than overwritten: silently replacing
   * a verb changes what every existing statement using it means.
   */
  predicateConflicts: string[];
}

export interface KnowledgePackInstallOptions {
  /** Replace a type of the same name (backed up first). Defaults to false. */
  replaceExisting?: boolean;
  /**
   * Required when the pack's arrival is a destructive schema change for a type
   * this project already has. Passed straight through to the existing gate.
   */
  confirmDestructive?: boolean;
}

export class UnknownKnowledgePackError extends Error {
  constructor(public readonly packId: string) {
    super(`Unknown knowledge pack '${packId}'`);
    this.name = 'UnknownKnowledgePackError';
  }
}

export async function installKnowledgePack(
  workspacePath: string,
  packId: string,
  options: KnowledgePackInstallOptions = {},
): Promise<KnowledgePackInstallResult> {
  if (!workspacePath) throw new Error('workspacePath is required');
  const pack = getKnowledgePack(packId);
  if (!pack) throw new UnknownKnowledgePackError(packId);

  // Refuse before writing anything, rather than fail mid-pack on a path that
  // cannot hold a schema file.
  const trackersDir = path.join(workspacePath, '.nimbalyst', 'trackers');
  for (const { type } of pack.types) {
    const override = await getWorkspaceTrackerSchemaOverride(workspacePath, type);
    const filePath = override.filePath ?? path.join(trackersDir, `${type}.yaml`);
    if (fs.existsSync(filePath) && !fs.statSync(filePath).isFile()) {
      throw new Error(`Cannot install '${pack.id}': ${filePath} is not a file`);
    }
  }

  // Predicates first. A type's relationship field may declare a `predicate:`,
  // and that declaration is checked against the registry at define time, so a
  // pack installed verbs-last would reject its own types.
  const predicatePath = path.join(workspacePath, '.nimbalyst', 'predicates.yaml');
  const predicateFileBefore = fs.existsSync(predicatePath) ? fs.readFileSync(predicatePath, 'utf-8') : null;
  // A null read means the file is there and broken. Installing on top of it
  // would discard verbs the project is still using, so refuse.
  const predicatesBefore = readWorkspacePredicateRegistry(workspacePath);
  if (predicatesBefore === null) {
    throw new Error(
      `Cannot install '${pack.id}': this project's predicates.yaml exists but does not parse. Fix or remove it first.`,
    );
  }

  const { added, conflicts } = await installPackPredicates(workspacePath, pack, predicatesBefore);

  const installed: string[] = [];
  const skipped: string[] = [];
  const writes: Array<{ type: string; filePath: string; backupPath?: string }> = [];

  try {
    for (const { type, yaml } of pack.types) {
      try {
      // The raw YAML, not a re-serialized model: the comments in a pack file
      // are the only place the reasoning behind a field lives, and a project
      // that installs the pack should get them.
        const write = await upsertWorkspaceTrackerSchema(workspacePath, yaml, {
          overwrite: options.replaceExisting === true,
          confirmDestructive: options.confirmDestructive,
        });
        writes.push({ type, filePath: write.filePath, backupPath: write.backupPath });
        installed.push(type);
      } catch (err) {
        if (err instanceof TrackerTypeExistsError) {
          skipped.push(type);
          continue;
        }
        throw err;
      }
    }
  } catch (error) {
    // A pack is one schema operation. Restore every file written earlier in
    // this attempt so a failure on a later type cannot leave dangling targets.
    // Backups are removed only once every restore has landed: until then they
    // may be the only copy of the user's original schema.
    const restoreFailures: string[] = [];
    const restore = async (label: string, action: () => Promise<void>) => {
      try {
        await action();
      } catch (restoreError) {
        restoreFailures.push(label);
        logger.main.error(`[knowledgePack] rollback could not restore ${label}`, restoreError);
      }
    };
    for (const write of [...writes].reverse()) {
      await restore(write.filePath, async () => {
        // The backup is the exact prior content of the path the write replaced.
        if (write.backupPath) {
          await fsPromises.copyFile(write.backupPath, write.filePath);
        } else {
          await fsPromises.rm(write.filePath, { force: true });
        }
      });
    }
    if (added.length > 0) {
      await restore(predicatePath, async () => {
        if (predicateFileBefore === null) {
          await fsPromises.rm(predicatePath, { force: true });
        } else {
          await fsPromises.writeFile(predicatePath, predicateFileBefore, 'utf-8');
        }
      });
    }
    if (restoreFailures.length === 0) {
      for (const write of writes) {
        if (write.backupPath) await fsPromises.rm(write.backupPath, { force: true });
      }
    }
    // Reload from disk through the same paths a hand edit takes, so a project
    // that is not the current one is not written into the global registry.
    refreshWorkspaceSchemasIfCurrent(workspacePath);
    await reloadWorkspacePredicateRegistry(workspacePath);
    if (restoreFailures.length > 0) {
      const backups = writes.flatMap(write => (write.backupPath ? [write.backupPath] : []));
      throw new Error(
        `Installing '${pack.id}' failed and rollback could not restore ${restoreFailures.join(', ')}.` +
        (backups.length ? ` Original schemas are kept at ${backups.join(', ')}.` : '') +
        ` Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  }

  logger.main.info(
    `[knowledgePack] installed '${packId}': ${installed.length} types, ${skipped.length} skipped, ${added.length} predicates`,
  );

  return {
    packId,
    installed,
    skipped,
    predicatesAdded: added,
    predicateConflicts: conflicts,
  };
}

/**
 * Add the pack's verbs to whatever the project already has.
 *
 * Additive, unlike the room's published registry which replaces wholesale.
 * These are two different operations: a sync apply carries the team's entire
 * agreed vocabulary, while an install adds one domain's verbs to a project that
 * may already have others. An id the project already defines DIFFERENTLY is
 * left as it is and reported, because the existing statements using it were
 * written against the existing meaning.
 */
async function installPackPredicates(
  workspacePath: string,
  pack: KnowledgePack,
  existing: readonly PredicateDefinition[],
): Promise<{ added: string[]; conflicts: string[] }> {
  if (!pack.predicatesYaml) return { added: [], conflicts: [] };

  const parsed = parsePredicateRegistryYAML(pack.predicatesYaml);
  if (!parsed.valid) {
    throw new Error(
      `Knowledge pack '${pack.id}' has an invalid predicate registry: ` +
      parsed.issues.map(i => `${i.code} at '${i.path}'`).join('; '),
    );
  }

  const { merged, added, conflicts } = mergePackPredicates(existing, parsed.predicates);

  if (added.length) {
    await writeWorkspacePredicateRegistry(workspacePath, merged);
    // Scoped the way a hand edit is: a project that is not current gets its
    // own layer instead of replacing the current project's verbs.
    await reloadWorkspacePredicateRegistry(workspacePath);
  }

  return { added, conflicts };
}

/**
 * The merge decision, separated from the filesystem so it is testable on its
 * own. An id the project already defines identically is neither an addition nor
 * a conflict -- re-running an install must be quiet.
 */
export function mergePackPredicates(
  existing: readonly PredicateDefinition[],
  incoming: readonly PredicateDefinition[],
): { merged: PredicateDefinition[]; added: string[]; conflicts: string[] } {
  const byId = new Map<string, PredicateDefinition>(existing.map(p => [p.id, p]));
  const added: string[] = [];
  const conflicts: string[] = [];

  for (const predicate of incoming) {
    const current = byId.get(predicate.id);
    if (!current) {
      byId.set(predicate.id, predicate);
      added.push(predicate.id);
      continue;
    }
    if (JSON.stringify(current) !== JSON.stringify(predicate)) {
      conflicts.push(predicate.id);
    }
  }

  return { merged: [...byId.values()], added, conflicts };
}
