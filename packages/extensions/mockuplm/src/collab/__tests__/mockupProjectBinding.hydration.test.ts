// @vitest-environment node
/**
 * Reopening a shared project offline is served entirely from the durable local
 * replica: the Y.Doc is hydrated after the binding already exists, and the
 * hydration transaction carries the SDK's bootstrap origin. The binding used to
 * discard exactly that origin, so the reopened editor rendered zero screens
 * while the replica plainly contained them.
 *
 * Real Y.Docs and the real Zustand store -- the defect lives in the interaction
 * between them, so mocking either one would test nothing. CSV and Data Model
 * had the same defect, which is why this is pinned rather than left to the
 * two-client E2E row.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { COLLAB_INIT_ORIGIN } from '@nimbalyst/extension-sdk';
import { MockupProjectBinding } from '../mockupProjectBinding';
import { createMockupProjectStore } from '../../store/projectStore';
import { seedMockupProjectYDoc } from '../seed';

const PROJECT_FILE = JSON.stringify({
  version: 1,
  name: 'Durable project',
  mockups: [
    {
      id: 'screen-alpha',
      path: 'alpha.mockup.html',
      label: 'Alpha screen',
      position: { x: 10, y: 20 },
      size: { width: 400, height: 300 },
    },
    {
      id: 'screen-bravo',
      path: 'bravo.mockup.html',
      label: 'Bravo screen',
      position: { x: 500, y: 20 },
      size: { width: 400, height: 300 },
    },
  ],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

/** Bytes a durable replica would hand back on reopen. */
function replicaUpdate(): Uint8Array {
  const source = new Y.Doc();
  source.transact(() => seedMockupProjectYDoc(source, PROJECT_FILE), COLLAB_INIT_ORIGIN);
  const update = Y.encodeStateAsUpdate(source);
  source.destroy();
  return update;
}

function labels(store: ReturnType<typeof createMockupProjectStore>): string[] {
  return store
    .getState()
    .mockups.map((mockup) => mockup.label)
    .sort();
}

describe('MockupProjectBinding hydration', () => {
  it('projects a bootstrap-origin hydration that lands after bind into the store', () => {
    const yDoc = new Y.Doc();
    const store = createMockupProjectStore();
    const binding = new MockupProjectBinding(yDoc, store);
    expect(store.getState().mockups).toHaveLength(0);

    Y.applyUpdate(yDoc, replicaUpdate(), COLLAB_INIT_ORIGIN);

    expect(labels(store)).toEqual(['Alpha screen', 'Bravo screen']);
    expect(store.getState().name).toBe('Durable project');
    binding.destroy();
    yDoc.destroy();
  });

  it('projects a hydration that lands before bind, and does not re-write the doc', () => {
    const yDoc = new Y.Doc();
    Y.applyUpdate(yDoc, replicaUpdate(), COLLAB_INIT_ORIGIN);
    const store = createMockupProjectStore();
    const binding = new MockupProjectBinding(yDoc, store);

    expect(labels(store)).toEqual(['Alpha screen', 'Bravo screen']);
    // The constructor's own projection must not echo back as local writes: a
    // second copy of each screen here would mean the store->Y.Doc diff ran
    // against a stale baseline.
    expect(yDoc.getMap('mockups').size).toBe(2);
    binding.destroy();
    yDoc.destroy();
  });

  it('carries a screen added after hydration back into the doc', () => {
    const yDoc = new Y.Doc();
    const store = createMockupProjectStore();
    const binding = new MockupProjectBinding(yDoc, store);
    Y.applyUpdate(yDoc, replicaUpdate(), COLLAB_INIT_ORIGIN);

    store.getState().addMockup({ path: 'charlie.mockup.html', label: 'Charlie screen' });

    expect(labels(store)).toEqual(['Alpha screen', 'Bravo screen', 'Charlie screen']);
    expect(yDoc.getMap('mockups').size).toBe(3);
    binding.destroy();
    yDoc.destroy();
  });
});
