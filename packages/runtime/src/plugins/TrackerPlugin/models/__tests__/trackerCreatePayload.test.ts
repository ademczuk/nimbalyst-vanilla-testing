// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { TrackerDataModelRegistry, type TrackerDataModel } from '../TrackerDataModel';
import { buildTrackerCreatePayload } from '../trackerCreatePayload';

/** A schema that renames every role field, which is what the old call sites broke on. */
const renamedRoles: TrackerDataModel = {
  type: 'ticket',
  displayName: 'Ticket',
  displayNamePlural: 'Tickets',
  icon: 'bug_report',
  color: '#f00',
  modes: { inline: true, fullDocument: false },
  idPrefix: 'tik',
  idFormat: 'uuid',
  sharing: 'team',
  draftByDefault: true,
  roles: { workflowStatus: 'state', priority: 'urgency', assignee: 'assignedTo', tags: 'labels' },
  fields: [
    { name: 'title', type: 'string', required: true },
    { name: 'state', type: 'select', default: 'triage', options: [{ value: 'triage', label: 'Triage' }] },
    { name: 'urgency', type: 'select', default: 'p3', options: [{ value: 'p3', label: 'P3' }] },
    { name: 'assignedTo', type: 'user' },
    { name: 'labels', type: 'array', itemType: 'string' },
    { name: 'component', type: 'string', default: 'core' },
  ],
};

const requiredField: TrackerDataModel = {
  ...renamedRoles,
  type: 'release',
  idPrefix: 'rel',
  sharing: 'personal',
  draftByDefault: false,
  roles: {},
  fields: [
    { name: 'title', type: 'string', required: true },
    { name: 'status', type: 'string', default: 'to-do' },
    { name: 'shipDate', type: 'date', required: true },
  ],
};

function registryWith(...models: TrackerDataModel[]): TrackerDataModelRegistry {
  const registry = new TrackerDataModelRegistry();
  for (const model of models) registry.register(model);
  return registry;
}

const ctx = (registry: TrackerDataModelRegistry) => ({
  workspacePath: '/workspace',
  registry,
  generateId: () => 'tik_fixed',
});

describe('buildTrackerCreatePayload', () => {
  it('routes renamed role fields to the fixed payload keys and keeps the schema name in customFields', () => {
    const registry = registryWith(renamedRoles);
    const result = buildTrackerCreatePayload(
      'ticket',
      { title: '  Editor hangs on paste  ', fields: { assignedTo: 'greg', labels: ['perf'] } },
      ctx(registry),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      id: 'tik_fixed',
      type: 'ticket',
      title: 'Editor hangs on paste',
      // Read off `state`/`urgency` defaults, not a hardcoded 'to-do'/'medium'.
      status: 'triage',
      priority: 'p3',
      workspace: '/workspace',
      owner: 'greg',
      tags: ['perf'],
      customFields: {
        state: 'triage',
        urgency: 'p3',
        assignedTo: 'greg',
        labels: ['perf'],
        component: 'core',
      },
      sharing: 'team',
      draftByDefault: true,
    });
  });

  it('applies schema defaults and the canonical fallbacks when the schema declares no roles', () => {
    const registry = registryWith(requiredField);
    const result = buildTrackerCreatePayload(
      'release',
      { title: 'v2', description: 'Ship it', fields: { shipDate: '2026-09-01' } },
      { workspacePath: '/workspace', registry, generateId: () => 'rel_fixed' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      status: 'to-do',
      priority: 'medium',
      description: 'Ship it',
      customFields: { shipDate: '2026-09-01' },
      sharing: 'personal',
      draftByDefault: false,
    });
    // `status` is carried by the top-level key; it must not be duplicated.
    expect(result.payload.customFields).not.toHaveProperty('status');
    expect(result.payload.customFields).not.toHaveProperty('title');
  });

  it('refuses to write when a required field is unset', () => {
    const registry = registryWith(requiredField);
    const result = buildTrackerCreatePayload('release', { title: 'v2' }, ctx(registry));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ field: 'shipDate', message: "Field 'shipDate' is required" }]);
  });

  it('rejects unknown and non-creatable types instead of silently writing', () => {
    const registry = registryWith({ ...renamedRoles, type: 'readonly', creatable: false });
    expect(buildTrackerCreatePayload('nope', { title: 'x' }, ctx(registry))).toMatchObject({ ok: false });
    expect(buildTrackerCreatePayload('readonly', { title: 'x' }, ctx(registry))).toMatchObject({ ok: false });
  });
});
