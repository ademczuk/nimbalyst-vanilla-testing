/**
 * The LOCAL COPY of a workspace's predicate registry: `.nimbalyst/predicates.yaml`.
 *
 * Per decision 12 of the knowledge-scopes plan, and per
 * `docs/TRACKER_SCHEMA_SHARING.md`, this file is a copy and never the
 * distribution mechanism for a team project. The room owns the registry and
 * publishes it to every client on the schema lane, exactly as it does type
 * definitions; this module projects what arrived onto disk so the project is
 * readable offline, diffable in git, and authorable by a project that has no
 * room yet.
 *
 * A sibling of `trackerSchemaProjection.ts` rather than more of
 * `TrackerSchemaService.ts`, which is already 1,300 lines.
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import {
  parsePredicateRegistryYAML,
  serializePredicateRegistryYAML,
  type PredicateDefinition,
} from '@nimbalyst/tracker-schema';
import { logger } from '../../utils/logger';

export const PREDICATE_REGISTRY_FILENAME = 'predicates.yaml';

export function workspacePredicateRegistryPath(workspacePath: string): string {
  return path.join(workspacePath, '.nimbalyst', PREDICATE_REGISTRY_FILENAME);
}

/**
 * Read the local copy.
 *
 * Distinguishes three outcomes on purpose, because they call for different
 * behavior and conflating them is how a project silently loses its verbs:
 *
 *  - `[]` -- no file. An empty registry, which is the state of every project
 *    that has not adopted predicates.
 *  - a list -- a valid registry.
 *  - `null` -- the file exists and is unreadable or invalid. The caller keeps
 *    whatever registry is already in force rather than replacing it with
 *    nothing, since a half-typed hand edit must not invalidate every statement
 *    in the project until the author saves again.
 */
export function readWorkspacePredicateRegistry(workspacePath: string): PredicateDefinition[] | null {
  const filePath = workspacePredicateRegistryPath(workspacePath);
  let content: string;
  try {
    if (!fs.existsSync(filePath)) return [];
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    logger.main.warn('[trackerPredicateRegistry] could not read', filePath, err);
    return null;
  }

  const result = parsePredicateRegistryYAML(content);
  if (!result.valid) {
    logger.main.warn(
      `[trackerPredicateRegistry] ${filePath} is invalid; keeping the registry already in force:`,
      result.issues.map(issue => `${issue.code} at '${issue.path}': ${issue.message}`).join('; '),
    );
    return null;
  }
  return result.predicates;
}

/**
 * Project a registry onto the local copy.
 *
 * An empty registry writes the file rather than deleting it: "this project has
 * no predicates" and "this project has not been synced" are different states,
 * and only the file distinguishes them for a reader looking at the checkout.
 */
export async function writeWorkspacePredicateRegistry(
  workspacePath: string,
  predicates: readonly PredicateDefinition[],
): Promise<string> {
  const filePath = workspacePredicateRegistryPath(workspacePath);
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  await fsPromises.writeFile(filePath, serializePredicateRegistryYAML(predicates), 'utf-8');
  return filePath;
}
