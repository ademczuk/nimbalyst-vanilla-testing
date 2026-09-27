/**
 * The desktop's schema-lane hooks: tracker type definitions plus the predicate
 * registry, which shares the lane under a reserved schema type (NIM-6653).
 *
 * The engine sees one lane. This routes each row to its owner, so neither the
 * type-def store nor the registry needs to know the other exists.
 */

import type { TrackerSchemaSyncHooks } from '@nimbalyst/tracker-engine';
import { TRACKER_PREDICATE_REGISTRY_SCHEMA_TYPE } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/schemaSyncPayload';
import {
  applyRemotePredicateRegistry,
  listUnsyncedPredicateRegistry,
  markPredicateRegistryRejected,
  type PredicateRegistryLaneOptions,
} from './trackerPredicateRegistrySync';

export function composeTrackerSchemaSyncHooks(
  workspacePath: string,
  typeDefs: TrackerSchemaSyncHooks,
  registry: PredicateRegistryLaneOptions = {},
): TrackerSchemaSyncHooks {
  return {
    listUnsynced: async () => [
      ...(await typeDefs.listUnsynced()),
      ...listUnsyncedPredicateRegistry(workspacePath, registry),
    ],
    applyRemote: (def) => def.type === TRACKER_PREDICATE_REGISTRY_SCHEMA_TYPE
      ? applyRemotePredicateRegistry(workspacePath, def, registry)
      : typeDefs.applyRemote(def),
    markRejected: async (type, code) => {
      if (type === TRACKER_PREDICATE_REGISTRY_SCHEMA_TYPE) {
        markPredicateRegistryRejected(workspacePath, registry);
        return;
      }
      await typeDefs.markRejected?.(type, code);
    },
  };
}
