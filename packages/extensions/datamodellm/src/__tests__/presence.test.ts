// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { extractRemotePresences, indexPresences } from '../collab/presence';

const user = (id: string, name = 'Ada', color = '#ff0000') => ({ id, name, color });

describe('extractRemotePresences', () => {
  it('keeps remote collaborators with a selection and drops the rest', () => {
    const states = new Map<number, any>([
      [1, { user: user('me'), selectedEntityId: 'entity-local' }], // local client
      [2, { user: user('u2', 'Grace', '#00ff00'), selectedEntityId: 'entity-a' }],
      [3, { user: user('u3'), selectedRelationshipId: 'rel-a' }],
      [4, { user: user('u4') }], // present but nothing selected -- nothing to draw
      [5, { selectedEntityId: 'entity-b' }], // no user.id
      [6, { user: user('u6'), selectedEntityId: 42 }], // non-string id
    ]);

    expect(extractRemotePresences(states, 1)).toEqual([
      {
        clientId: 2,
        userId: 'u2',
        name: 'Grace',
        color: '#00ff00',
        selectedEntityId: 'entity-a',
        selectedRelationshipId: null,
      },
      {
        clientId: 3,
        userId: 'u3',
        name: 'Ada',
        color: '#ff0000',
        selectedEntityId: null,
        selectedRelationshipId: 'rel-a',
      },
    ]);
  });

  it('falls back to a generic name and color when the user record is partial', () => {
    const states = new Map<number, any>([
      [2, { user: { id: 'u2', name: '   ' }, selectedEntityId: 'entity-a' }],
    ]);
    const [presence] = extractRemotePresences(states, 1);
    expect(presence.name).toBe('Collaborator');
    expect(presence.color).toBe('#888888');
  });
});

describe('indexPresences', () => {
  it('buckets by target and collapses one user viewing from two tabs', () => {
    const presences = extractRemotePresences(
      new Map<number, any>([
        [2, { user: user('u2'), selectedEntityId: 'entity-a' }],
        [3, { user: user('u2'), selectedEntityId: 'entity-a' }], // same user, second tab
        [4, { user: user('u4'), selectedEntityId: 'entity-a', selectedRelationshipId: 'rel-a' }],
      ]),
      1,
    );

    const index = indexPresences(presences);
    expect(index.entities.get('entity-a')?.map((p) => p.userId)).toEqual(['u2', 'u4']);
    expect(index.relationships.get('rel-a')?.map((p) => p.userId)).toEqual(['u4']);
    expect(index.entities.get('entity-unknown')).toBeUndefined();
  });
});
