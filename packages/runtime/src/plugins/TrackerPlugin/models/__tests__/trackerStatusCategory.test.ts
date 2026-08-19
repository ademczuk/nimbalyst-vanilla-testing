// @vitest-environment node
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { loadBuiltinTrackers } from '../ModelLoader';
import { globalRegistry, type TrackerDataModel } from '../TrackerDataModel';
import {
  resolveStatusCategory,
  isTerminalStatus,
  isDoneStatus,
  isCancelledStatus,
  statusValuesInCategories,
  getDoneStatusValue,
} from '../trackerStatusCategory';

beforeAll(() => {
  loadBuiltinTrackers();
});

const CUSTOM_TYPE = 'widget-under-test';

function registerCustomType(model: Partial<TrackerDataModel> & { fields: TrackerDataModel['fields'] }): void {
  globalRegistry.register({
    type: CUSTOM_TYPE,
    displayName: 'Widget',
    displayNamePlural: 'Widgets',
    icon: 'widgets',
    color: '#888888',
    modes: { inline: true, fullDocument: false },
    idPrefix: 'widget',
    idFormat: 'ulid',
    roles: { workflowStatus: 'status' },
    ...model,
  } as TrackerDataModel);
}

afterEach(() => {
  globalRegistry.unregister(CUSTOM_TYPE);
});

describe('resolution tiers', () => {
  it('prefers the declared category over anything the name suggests', () => {
    // `done` is the most strongly done-shaped name there is. A schema that
    // declares otherwise still wins, or the declaration means nothing.
    registerCustomType({
      fields: [
        { name: 'title', type: 'string' },
        {
          name: 'status',
          type: 'select',
          default: 'fresh',
          options: [
            { value: 'fresh', label: 'Fresh' },
            { value: 'done', label: 'Done', category: 'started' },
          ],
        },
      ],
    });

    expect(resolveStatusCategory(CUSTOM_TYPE, 'done')).toBe('started');
    expect(isTerminalStatus(CUSTOM_TYPE, 'done')).toBe(false);
  });

  it('falls back to the legacy name table for undeclared options', () => {
    registerCustomType({
      fields: [
        { name: 'title', type: 'string' },
        {
          name: 'status',
          type: 'select',
          default: 'fresh',
          options: [
            { value: 'fresh', label: 'Fresh' },
            { value: 'shipped', label: 'Shipped' },
            { value: 'abandoned', label: 'Abandoned' },
          ],
        },
      ],
    });

    expect(resolveStatusCategory(CUSTOM_TYPE, 'shipped')).toBe('done');
    expect(resolveStatusCategory(CUSTOM_TYPE, 'abandoned')).toBe('cancelled');
  });

  it('never infers terminal for a status it does not recognise', () => {
    // The asymmetry that decides tier 3: guessing terminal hides an open item,
    // guessing open shows a closed one. Only the second is recoverable.
    registerCustomType({
      fields: [
        { name: 'title', type: 'string' },
        {
          name: 'status',
          type: 'select',
          default: 'intake',
          options: [
            { value: 'intake', label: 'Intake' },
            { value: 'percolating', label: 'Percolating' },
            { value: 'crystallised', label: 'Crystallised' },
          ],
        },
      ],
    });

    expect(resolveStatusCategory(CUSTOM_TYPE, 'intake')).toBe('unstarted');
    expect(resolveStatusCategory(CUSTOM_TYPE, 'percolating')).toBe('started');
    expect(resolveStatusCategory(CUSTOM_TYPE, 'crystallised')).toBe('started');
    expect(isTerminalStatus(CUSTOM_TYPE, 'crystallised')).toBe(false);
  });

  it('resolves a value the schema never declared without throwing', () => {
    // A peer on a different schema set can send a status this install has no
    // option for; the validator preserves it as a warning rather than
    // destroying it, so the resolver has to answer for it too.
    expect(resolveStatusCategory('bug', 'some-status-from-a-peer')).toBe('started');
    expect(isTerminalStatus('bug', 'some-status-from-a-peer')).toBe(false);
  });

  it('honours the workflowStatus role instead of assuming the field is named status', () => {
    registerCustomType({
      roles: { workflowStatus: 'phase' },
      fields: [
        { name: 'title', type: 'string' },
        { name: 'status', type: 'select', options: [{ value: 'done', label: 'Done' }] },
        {
          name: 'phase',
          type: 'select',
          default: 'open',
          options: [
            { value: 'open', label: 'Open' },
            { value: 'retired', label: 'Retired', category: 'done' },
          ],
        },
      ],
    });

    expect(resolveStatusCategory(CUSTOM_TYPE, 'retired')).toBe('done');
  });
});

describe('the builtins', () => {
  it('categorises each type\'s own closing status as terminal', () => {
    expect(isDoneStatus('bug', 'done')).toBe(true);
    expect(isDoneStatus('task', 'done')).toBe(true);
    expect(isDoneStatus('plan', 'completed')).toBe(true);
    expect(isDoneStatus('decision', 'decided')).toBe(true);
    expect(isDoneStatus('decision', 'implemented')).toBe(true);
    expect(isDoneStatus('milestone', 'done')).toBe(true);
    expect(isDoneStatus('release', 'released')).toBe(true);
  });

  it('separates abandoned work from finished work', () => {
    expect(isCancelledStatus('plan', 'rejected')).toBe(true);
    expect(isCancelledStatus('idea', 'rejected')).toBe(true);
    expect(isCancelledStatus('milestone', 'cancelled')).toBe(true);
    expect(isCancelledStatus('release', 'cancelled')).toBe(true);
    expect(isCancelledStatus('bug', 'wont-do')).toBe(true);
    expect(isCancelledStatus('bug', 'duplicate')).toBe(true);
    expect(isDoneStatus('bug', 'wont-do')).toBe(false);
  });

  it('keeps the whole review lane in flight', () => {
    for (const status of ['in-review', 'changes-requested', 'approved']) {
      expect(resolveStatusCategory('bug', status)).toBe('started');
      expect(resolveStatusCategory('task', status)).toBe('started');
    }
  });

  it('leaves an accepted idea open, because accepting is not delivering', () => {
    expect(resolveStatusCategory('idea', 'accepted')).toBe('started');
    expect(isTerminalStatus('idea', 'accepted')).toBe(false);
    // An idea therefore has no way to finish -- it ends cancelled or converted.
    expect(getDoneStatusValue('idea')).toBeUndefined();
  });

  it('names the status a type closes into, for callers that must write one', () => {
    expect(getDoneStatusValue('bug')).toBe('done');
    expect(getDoneStatusValue('plan')).toBe('completed');
    expect(getDoneStatusValue('release')).toBe('released');
  });
});

describe('expanding categories to values', () => {
  it('collects the terminal values across several types at once', () => {
    const closed = statusValuesInCategories(['bug', 'plan', 'idea'], ['done', 'cancelled']);
    expect([...closed].sort()).toEqual(
      ['completed', 'done', 'duplicate', 'rejected', 'wont-do'].sort(),
    );
    // The review lane must not leak into a "closed" expansion.
    expect(closed.has('approved')).toBe(false);
  });
});
