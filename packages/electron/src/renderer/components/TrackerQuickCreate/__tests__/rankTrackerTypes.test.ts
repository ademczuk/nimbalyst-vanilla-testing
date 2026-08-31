// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { TrackerDataModel } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/TrackerDataModel';
import { rankTrackerTypes } from '../rankTrackerTypes';

function model(type: string, displayName: string): TrackerDataModel {
  return {
    type,
    displayName,
    displayNamePlural: `${displayName}s`,
    icon: 'label',
    color: '#000',
    modes: { inline: true, fullDocument: false },
    idPrefix: type.slice(0, 3),
    idFormat: 'uuid',
    fields: [{ name: 'title', type: 'string', required: true }],
  };
}

const models = [
  model('bug', 'Bug'),
  model('task', 'Task'),
  model('decision', 'Decision'),
  model('blog', 'Blog'),
];

const names = (query: string, recents: string[] = []) =>
  rankTrackerTypes(models, query, recents).map((choice) => choice.model.type);

describe('rankTrackerTypes', () => {
  it('leads with recents and falls back to alphabetical order', () => {
    expect(names('', ['task', 'blog'])).toEqual(['task', 'blog', 'bug', 'decision']);
    expect(names('')).toEqual(['blog', 'bug', 'decision', 'task']);
  });

  it('ranks the closer name above a recent but weaker match', () => {
    // "b" hits Blog and Bug; recency must not float a worse match to the top,
    // it only settles ties.
    expect(names('bug', ['blog'])[0]).toBe('bug');
    expect(names('blo', ['bug'])[0]).toBe('blog');
  });

  it('matches the type slug as well as the display name', () => {
    expect(names('decision')).toEqual(['decision']);
    expect(names('zzz')).toEqual([]);
  });

  it('reports matched indices against the display name for highlighting', () => {
    const [choice] = rankTrackerTypes(models, 'ug', []);
    expect(choice.model.type).toBe('bug');
    expect(choice.matchedIndices).toEqual([1, 2]);
  });
});
