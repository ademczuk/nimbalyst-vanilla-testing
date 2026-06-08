import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { mkdtemp, writeFile, rm } from 'fs/promises';

// SyncManager pulls in heavy main-process wiring; stub the only function the
// service touches at import/runtime so the unit can construct in isolation.
vi.mock('../SyncManager', () => ({
  getPersonalDocSyncConfig: () => null,
}));

import { ProjectFileSyncService } from '../ProjectFileSyncService';

/** Deterministic syncId derivation -- must match ProjectFileSyncService.syncIdFromPath. */
function syncIdFromPath(relativePath: string): string {
  return createHash('sha256').update(relativePath).digest('hex');
}

describe('ProjectFileSyncService.handleFileSaved', () => {
  let tmpDir: string;
  let service: ProjectFileSyncService;
  let pushFileContent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'pfs-test-'));
    service = new ProjectFileSyncService();

    pushFileContent = vi.fn(async () => undefined);
    // Inject a mock provider so no real WebSocket / encryption is needed.
    (service as any).provider = { pushFileContent };

    // Simulate a project that completed its startup sweep: the file-map cache
    // exists (keyed by encryptedProjectId) and a project state map is present.
    (service as any)._fileMapCache = new Map<string, { fileMap: Map<string, string>; workspacePath: string }>();
    (service as any)._fileMapCache.set('proj-enc', { fileMap: new Map<string, string>(), workspacePath: tmpDir });
    (service as any).projectStates.set('proj-enc', new Map());
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('pushes a newly created markdown file to the server', async () => {
    const fsp = await import('fs/promises');
    const filePath = path.join(tmpDir, 'design', 'new-doc.md');
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '# Hello\n', 'utf-8');

    await service.handleFileSaved(filePath, tmpDir, 'proj-enc');

    expect(pushFileContent).toHaveBeenCalledTimes(1);
  });

  it('registers the newly created file in the project file-map for remote round-trips', async () => {
    const fsp = await import('fs/promises');
    const filePath = path.join(tmpDir, 'design', 'round-trip.md');
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '# Round trip\n', 'utf-8');

    await service.handleFileSaved(filePath, tmpDir, 'proj-enc');

    const relativePath = path.relative(tmpDir, filePath);
    const syncId = syncIdFromPath(relativePath);
    const cache = (service as any)._fileMapCache.get('proj-enc') as { fileMap: Map<string, string> };

    // The new file must be discoverable by syncId so a later remote delete /
    // update from mobile can be applied to the correct local path.
    expect(cache.fileMap.get(syncId)).toBe(filePath);
  });
});
