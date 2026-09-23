/**
 * Pin-on-cite (knowledge-scopes contract 4.2).
 *
 * Revision history is recorded only for knowledge types, so an ordinary item
 * (a bug, a task) has no revision a citation could pin. This fills that gap at
 * the moment of citing: every value written to a `cites` relationship field
 * without a `revisionId` gets one, from `pinItemRevision`.
 *
 * Runs after `applyRelationshipFieldWrites`, on the canonical values it left in
 * `data`. A write that re-sends a target the field already cited keeps the
 * existing pin rather than moving it to the item's current state: moving a pin
 * silently changes what the evidence was about.
 */

import type { FieldDefinition } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import {
  isRelationshipField,
  normalizeRelationshipValue,
  serializeRelationshipValue,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import type { AppDatabase } from '../../database/PGLiteDatabaseWorker';
import { readStoredFieldValue } from './relationshipFieldStorage';
import { pinItemRevision, TrackerItemNotFoundError } from './trackerItemRevisionStore';
import { logger } from '../../utils/logger';

const CITES = 'cites';

export async function pinCitedRevisions(
  db: AppDatabase,
  workspacePath: string,
  sourceItemId: string,
  data: Record<string, unknown>,
  fieldDefs: readonly FieldDefinition[],
): Promise<void> {
  let storedData: Record<string, unknown> | null | undefined;
  const loadStoredData = async () => {
    if (storedData !== undefined) return storedData;
    const result = await db.query<{ data: unknown }>(
      'SELECT data FROM tracker_items WHERE id = $1 AND workspace = $2',
      [sourceItemId, workspacePath],
    );
    const raw = result.rows[0]?.data;
    storedData = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown> | null) ?? null;
    return storedData;
  };

  for (const def of fieldDefs) {
    if (!isRelationshipField(def) || def.relationshipTypeKey !== CITES) continue;
    if (!(def.name in data)) continue;
    const values = normalizeRelationshipValue(data[def.name]);
    if (values.every(value => value.revisionId)) continue;

    const existingPins = new Map<string, string>();
    for (const previous of normalizeRelationshipValue(readStoredFieldValue(await loadStoredData(), def.name))) {
      if (previous.revisionId) existingPins.set(previous.itemId, previous.revisionId);
    }

    for (const value of values) {
      if (value.revisionId) continue;
      const kept = existingPins.get(value.itemId);
      if (kept) {
        value.revisionId = kept;
        continue;
      }
      try {
        value.revisionId = await pinItemRevision(db, workspacePath, value.itemId);
      } catch (error) {
        // A target that is not in this workspace's database (for example a team
        // item that has not synced yet) is cited unpinned rather than refused;
        // the citation still names the item.
        if (!(error instanceof TrackerItemNotFoundError)) throw error;
        logger.main.warn(`[citationPins] cited item ${value.itemId} not found locally; left unpinned`);
      }
    }
    data[def.name] = serializeRelationshipValue(def, values);
  }
}
