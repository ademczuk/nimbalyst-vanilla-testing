/**
 * The schema-lane hooks a desktop tracker engine runs with: `tracker_type_defs`
 * for type definitions and the predicate registry lane, installed into this
 * process's registry. Shared by the production engine and the scripted-IPC test
 * engine so the two cannot drift.
 */

import type { TrackerSchemaSyncHooks } from '@nimbalyst/tracker-engine';
import {
  applyRemoteWorkspaceTrackerSchemaDef,
  applyWorkspacePredicateRegistryInProcess,
  encodeTrackerSchemaDefForPush,
} from '../TrackerSchemaService';
import { listUnsyncedTrackerSchemaDefs, markTrackerSchemaDefRejected } from './trackerTypeDefStore';
import { composeTrackerSchemaSyncHooks } from './trackerSchemaSyncHooks';

export function createDesktopTrackerSchemaSyncHooks(workspacePath: string): TrackerSchemaSyncHooks {
  return composeTrackerSchemaSyncHooks(workspacePath, {
    // An override of a builtin goes out as a DELTA so each peer resolves it
    // against its own builtin and keeps receiving shipped fields (#1178).
    listUnsynced: async () =>
      (await listUnsyncedTrackerSchemaDefs(workspacePath)).map(encodeTrackerSchemaDefForPush),
    applyRemote: (def) => applyRemoteWorkspaceTrackerSchemaDef(workspacePath, def),
    markRejected: (type) => markTrackerSchemaDefRejected(workspacePath, type),
  }, { onApplied: applyWorkspacePredicateRegistryInProcess });
}
