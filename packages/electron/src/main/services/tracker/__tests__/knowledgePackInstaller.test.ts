// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PredicateDefinition } from '@nimbalyst/tracker-schema';

// A pack with verbs AND types, where the last type fails: no shipped pack has
// both, and the rollback has to undo each kind of write.
vi.mock('../packs/knowledgePacks', () => ({
  getKnowledgePack: (id: string) => id === 'test-pack'
    ? {
      id: 'test-pack',
      label: 'Test pack',
      description: '',
      predicatesYaml: [
        'predicates:',
        '  - id: integrates-with',
        '    label: integrates with',
        '    subjectKinds: ["entity"]',
        '    valueShape: entity',
        '    direction: directed',
        '',
      ].join('\n'),
      types: ['alpha', 'beta', 'gamma'].map(type => ({ type, yaml: `type: ${type}\n` })),
    }
    : undefined,
}));

// Stands in for the real schema write: same file, backup and "exists" contract.
const schemaService = vi.hoisted(() => ({
  refreshWorkspaceSchemasIfCurrent: vi.fn(),
  reloadWorkspacePredicateRegistry: vi.fn(async () => {}),
}));
vi.mock('../../TrackerSchemaService', async () => {
  const fsp = await import('fs/promises');
  const nodeFs = await import('fs');
  const nodePath = await import('path');
  class TrackerTypeExistsError extends Error {}
  return {
    ...schemaService,
    TrackerTypeExistsError,
    getWorkspaceTrackerSchemaOverride: async () => ({ overridden: false }),
    upsertWorkspaceTrackerSchema: async (
      workspacePath: string,
      yaml: string,
      options: { overwrite?: boolean },
    ) => {
      const type = /^type: (\w+)/m.exec(yaml)![1];
      if (type === 'gamma') throw new Error('gamma rejected');
      const filePath = nodePath.join(workspacePath, '.nimbalyst', 'trackers', `${type}.yaml`);
      let backupPath: string | undefined;
      if (nodeFs.existsSync(filePath)) {
        if (!options.overwrite) throw new TrackerTypeExistsError(type);
        backupPath = `${filePath}.1.bak`;
        await fsp.copyFile(filePath, backupPath);
      }
      await fsp.writeFile(filePath, yaml, 'utf-8');
      return { model: { type }, filePath, backupPath };
    },
  };
});

import { installKnowledgePack, mergePackPredicates } from '../knowledgePackInstaller';

const base: PredicateDefinition = {
  id: 'integrates-with',
  label: 'integrates with',
  subjectKinds: ['entity'],
  valueShape: 'entity',
  direction: 'directed',
};

describe('mergePackPredicates', () => {
  it('adds a verb the project does not have', () => {
    const result = mergePackPredicates([], [base]);
    expect(result.added).toEqual(['integrates-with']);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual([base]);
  });

  it('is quiet when re-run against an identical definition', () => {
    // Installing twice must not rewrite the registry file, because a rewrite is
    // a schema change that the team sync lane would then republish.
    const result = mergePackPredicates([base], [{ ...base }]);
    expect(result.added).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('keeps the project definition when the pack disagrees, and reports it', () => {
    // The existing statements using this verb were written against the existing
    // meaning. Replacing it would change what they say with no edit to them.
    const narrowed: PredicateDefinition = { ...base, subjectKinds: ['product'] };
    const result = mergePackPredicates([narrowed], [base]);
    expect(result.conflicts).toEqual(['integrates-with']);
    expect(result.added).toEqual([]);
    expect(result.merged).toEqual([narrowed]);
  });

  it('leaves unrelated verbs the project already had in place', () => {
    const other: PredicateDefinition = { ...base, id: 'depends-on', label: 'depends on' };
    const result = mergePackPredicates([other], [base]);
    expect(result.merged.map(p => p.id)).toEqual(['depends-on', 'integrates-with']);
  });
});

describe('installKnowledgePack', () => {
  let workspace: string;
  let trackersDir: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-pack-rollback-'));
    trackersDir = path.join(workspace, '.nimbalyst', 'trackers');
    fs.mkdirSync(trackersDir, { recursive: true });
    schemaService.refreshWorkspaceSchemasIfCurrent.mockClear();
    schemaService.reloadWorkspacePredicateRegistry.mockClear();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('refuses before writing anything when a type path is not a file', async () => {
    fs.mkdirSync(path.join(trackersDir, 'gamma.yaml'));

    await expect(installKnowledgePack(workspace, 'test-pack')).rejects.toThrow(/is not a file/);

    expect(fs.existsSync(path.join(workspace, '.nimbalyst', 'predicates.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(trackersDir, 'alpha.yaml'))).toBe(false);
  });

  it('restores every file a failed install touched and reloads through the scoped paths', async () => {
    const predicatePath = path.join(workspace, '.nimbalyst', 'predicates.yaml');
    const originalPredicates = [
      'predicates:',
      '  - id: depends-on',
      '    label: depends on',
      '    subjectKinds: ["*"]',
      '    valueShape: entity',
      '    direction: directed',
      '',
    ].join('\n');
    fs.writeFileSync(predicatePath, originalPredicates);
    fs.writeFileSync(path.join(trackersDir, 'alpha.yaml'), 'ORIGINAL alpha');

    await expect(
      installKnowledgePack(workspace, 'test-pack', { replaceExisting: true }),
    ).rejects.toThrow('gamma rejected');

    // Replaced file restored, created file removed, verbs restored.
    expect(fs.readFileSync(path.join(trackersDir, 'alpha.yaml'), 'utf-8')).toBe('ORIGINAL alpha');
    expect(fs.existsSync(path.join(trackersDir, 'beta.yaml'))).toBe(false);
    expect(fs.readFileSync(predicatePath, 'utf-8')).toBe(originalPredicates);
    // Every restore landed, so the backup is redundant and removed.
    expect(fs.readdirSync(trackersDir).filter(f => f.endsWith('.bak'))).toEqual([]);
    // The in-memory registry is rebuilt from disk by the workspace-aware
    // helpers, never written directly for a project that may not be current.
    expect(schemaService.refreshWorkspaceSchemasIfCurrent).toHaveBeenCalledWith(workspace);
    expect(schemaService.reloadWorkspacePredicateRegistry).toHaveBeenLastCalledWith(workspace);
  });
});
