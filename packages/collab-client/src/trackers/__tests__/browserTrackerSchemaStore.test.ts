// @vitest-environment node

/**
 * The schema lane is where a browser tab can quietly render a tracker that is
 * not the tracker the team is using.
 *
 * An override of a builtin travels as a DELTA against the sender's builtin seed
 * (#1178), never as a full model. A host that treats the payload as a model
 * registers a type with no fields; a host that resolves it against the wrong
 * seed registers the wrong fields. Neither prints anything -- the grid simply
 * draws the wrong columns.
 */

import { describe, expect, it } from 'vitest';
import { encodeTrackerSchemaPatchPayload } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/schemaSyncPayload';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import { BrowserTrackerSchemaStore, resolveBrowserTrackerSchema } from '../browser/BrowserTrackerSchemaStore';

const seed = {
  type: 'bug',
  displayName: 'Bug',
  displayNamePlural: 'Bugs',
  icon: 'bug_report',
  color: '#f00',
  idPrefix: 'BUG',
  idFormat: 'uuid',
  modes: { inline: true, fullDocument: false },
  // A field the sender's build never mentioned: it must survive the delta.
  fields: [
    { name: 'title', type: 'text' },
    { name: 'severity', type: 'text' },
  ],
} as unknown as TrackerDataModel;

describe('resolving one inbound schema payload', () => {
  it('applies a delta on top of THIS build\'s builtin, keeping fields the sender never had', () => {
    const payload = encodeTrackerSchemaPatchPayload({
      type: 'bug',
      displayNamePlural: 'Defects',
    });
    const resolved = resolveBrowserTrackerSchema('bug', payload, () => seed);
    expect(resolved?.displayNamePlural).toBe('Defects');
    expect(resolved?.fields.map((field) => field.name)).toEqual(['title', 'severity']);
  });

  it('drops a delta whose builtin this build does not ship, rather than half-registering it', () => {
    const payload = encodeTrackerSchemaPatchPayload({ type: 'unknown-type', displayName: 'X' });
    expect(resolveBrowserTrackerSchema('unknown-type', payload, () => undefined)).toBeNull();
    expect(resolveBrowserTrackerSchema('bug', 'not json', () => seed)).toBeNull();
  });
});

describe('a personal tracker type, in a host with no personal lane', () => {
  const personalSeed = { ...seed, type: 'idea', sharing: 'personal' } as unknown as TrackerDataModel;

  it('is neither seeded from the builtins nor accepted from the room', async () => {
    const store = new BrowserTrackerSchemaStore({ builtins: [seed, personalSeed] });
    try {
      expect(store.getState().trackerTypes.map((model) => model.type)).toEqual(['bug']);

      // Arriving as a full model changes nothing: the type stays absent rather
      // than becoming a selectable tracker no room carries items for.
      await store.schemaSync.applyRemote({
        type: 'idea',
        model: JSON.stringify(personalSeed),
        syncId: 1 as never,
      });
      expect(store.getState().trackerTypes.map((model) => model.type)).toEqual(['bug']);

      // And a team type the room later makes personal is withdrawn, not left
      // behind as a stale team surface.
      await store.schemaSync.applyRemote({
        type: 'bug',
        model: JSON.stringify({ ...seed, sharing: 'personal' }),
        syncId: 2 as never,
      });
      expect(store.getState().trackerTypes).toEqual([]);
    } finally {
      store.dispose();
    }
  });

  it('is projected once the room shares it as the team\'s', async () => {
    const store = new BrowserTrackerSchemaStore({ builtins: [personalSeed] });
    try {
      await store.schemaSync.applyRemote({
        type: 'idea',
        model: encodeTrackerSchemaPatchPayload({ type: 'idea', sharing: 'team' }),
        syncId: 1 as never,
      });
      expect(store.getState().trackerTypes.map((model) => model.type)).toEqual(['idea']);
    } finally {
      store.dispose();
    }
  });
});

describe('the navigation lane', () => {
  it('keeps a malformed entry out of the tree instead of rendering a folder with no name', () => {
    const store = new BrowserTrackerSchemaStore({ builtins: [seed] });
    try {
      void store.navigationSync.applyRemote({
        entryId: 'folder:d',
        payload: JSON.stringify({ entryId: 'folder:d', kind: 'folder', folderId: 'd', name: 'Delivery', sortKey: 'a0', ownership: 'team' }),
        syncId: 1 as never,
      });
      void store.navigationSync.applyRemote({
        entryId: 'folder:bad',
        payload: JSON.stringify({ entryId: 'folder:bad', kind: 'folder' }),
        syncId: 2 as never,
      });
      expect(store.getState().navigationEntries.map((entry) => entry.entryId)).toEqual(['folder:d']);
    } finally {
      store.dispose();
    }
  });
});
