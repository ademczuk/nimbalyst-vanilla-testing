// @vitest-environment node
/**
 * The claim state machine and the per-card claimant derivation.
 *
 * Deliberately no rendering assertions: a broken cursor or a missing halo is a
 * one-second look at the screen, while "the claim outlived a release but not a
 * disconnect" is invisible to a reader and is exactly the bug that leaves a
 * board permanently haloed by a session that died.
 */
import { describe, expect, it } from 'vitest';

import type { CanvasAwarenessEntry } from '../canvasBinding';
import {
  applyCanvasWorkingSetEvent,
  canvasCardClaimants,
  canvasPresenceParticipants,
  canvasWorkingSetForBoard,
  CanvasWorkingSetRegistry,
  EMPTY_CANVAS_WORKING_SET,
  sameCanvasCardClaimants,
  type CanvasWorkingSetState,
} from '../canvasPresence';

const BOARD = '/w/board.canvas';

function declare(
  state: CanvasWorkingSetState,
  sessionId: string,
  nodeIds: readonly string[],
  boardKey = BOARD
): CanvasWorkingSetState {
  return applyCanvasWorkingSetEvent(state, {
    type: 'declare',
    declaration: {
      sessionId,
      sessionName: `Session ${sessionId}`,
      onBehalfOfUserId: 'user-greg',
      onBehalfOfDisplayName: 'Greg',
      boardKey,
      nodeIds,
    },
  });
}

function nodeIdsFor(
  state: CanvasWorkingSetState,
  sessionId: string,
  boardKey = BOARD
): readonly string[] {
  return (
    canvasWorkingSetForBoard(state, boardKey).find(
      (agent) => agent.sessionId === sessionId
    )?.nodeIds ?? []
  );
}

describe('canvas working-set state machine', () => {
  it('releases only the named cards and drops the session when empty', () => {
    let state = declare(EMPTY_CANVAS_WORKING_SET, 's1', ['a', 'b', 'c']);
    expect(nodeIdsFor(state, 's1')).toEqual(['a', 'b', 'c']);

    state = applyCanvasWorkingSetEvent(state, {
      type: 'release',
      sessionId: 's1',
      boardKey: BOARD,
      nodeIds: ['b'],
    });
    expect(nodeIdsFor(state, 's1')).toEqual(['a', 'c']);

    state = applyCanvasWorkingSetEvent(state, {
      type: 'release',
      sessionId: 's1',
      boardKey: BOARD,
    });
    expect(canvasWorkingSetForBoard(state, BOARD)).toEqual([]);
  });

  it('ends a claim that nothing but a disconnect ever touched', () => {
    let state = declare(EMPTY_CANVAS_WORKING_SET, 's1', ['a']);

    // Unrelated traffic must not disturb it: another session declaring, a
    // release aimed at a session that holds nothing, and a release naming a
    // card this session never claimed.
    state = declare(state, 's2', ['b']);
    state = applyCanvasWorkingSetEvent(state, {
      type: 'release',
      sessionId: 'never-declared',
    });
    state = applyCanvasWorkingSetEvent(state, {
      type: 'release',
      sessionId: 's1',
      boardKey: BOARD,
      nodeIds: ['z'],
    });
    expect(nodeIdsFor(state, 's1')).toEqual(['a']);

    state = applyCanvasWorkingSetEvent(state, {
      type: 'disconnect',
      sessionId: 's1',
    });
    expect(nodeIdsFor(state, 's1')).toEqual([]);
    // The disconnect is scoped to the session that died, not to the board.
    expect(nodeIdsFor(state, 's2')).toEqual(['b']);
  });

  it('moves a session wholesale when it declares on a second board', () => {
    let state = declare(EMPTY_CANVAS_WORKING_SET, 's1', ['a'], '/w/one.canvas');
    state = declare(state, 's1', ['b'], '/w/two.canvas');

    expect(canvasWorkingSetForBoard(state, '/w/one.canvas')).toEqual([]);
    expect(nodeIdsFor(state, 's1', '/w/two.canvas')).toEqual(['b']);
  });

  it('keeps state identity when an event changes nothing', () => {
    const state = declare(EMPTY_CANVAS_WORKING_SET, 's1', ['a', 'a']);
    expect(nodeIdsFor(state, 's1')).toEqual(['a']);

    expect(declare(state, 's1', ['a'])).toBe(state);
    expect(
      applyCanvasWorkingSetEvent(state, {
        type: 'disconnect',
        sessionId: 'someone-else',
      })
    ).toBe(state);
  });

  it('treats declaring an empty working set as a release', () => {
    let state = declare(EMPTY_CANVAS_WORKING_SET, 's1', ['a']);
    state = declare(state, 's1', []);
    expect(canvasWorkingSetForBoard(state, BOARD)).toEqual([]);
  });

  it('notifies only subscribers of boards whose claims changed', () => {
    const registry = new CanvasWorkingSetRegistry();
    let one = 0;
    let two = 0;
    registry.subscribe('/w/one.canvas', () => {
      one += 1;
    });
    registry.subscribe('/w/two.canvas', () => {
      two += 1;
    });

    registry.apply({
      type: 'declare',
      declaration: {
        sessionId: 's1',
        sessionName: 'Session 1',
        boardKey: '/w/one.canvas',
        nodeIds: ['a'],
      },
    });
    expect(one).toBe(1);
    expect(two).toBe(0);
    // Same board snapshot identity while nothing changed, so a subscriber can
    // use it directly as a `useSyncExternalStore` snapshot.
    expect(registry.getBoard('/w/one.canvas')).toBe(
      registry.getBoard('/w/one.canvas')
    );

    registry.apply({ type: 'disconnect', sessionId: 's1' });
    expect(one).toBe(2);
    expect(two).toBe(0);
    expect(registry.getBoard('/w/one.canvas')).toEqual([]);
  });
});

describe('canvas card claimants', () => {
  const entry = (
    clientId: number,
    overrides: Partial<CanvasAwarenessEntry>
  ): [number, CanvasAwarenessEntry] => [
    clientId,
    {
      clientId,
      user: { id: `u${clientId}`, name: `User ${clientId}`, color: '#ff0000' },
      ...overrides,
    },
  ];

  it('carries two claimants on one card, and keeps the agent first', () => {
    const entries = new Map<number, CanvasAwarenessEntry>([
      entry(1, {
        agents: [
          {
            sessionId: 'sess-a',
            sessionName: 'Refactor pass',
            onBehalfOfUserId: 'u1',
            onBehalfOfDisplayName: 'Greg',
            nodeIds: ['card-1'],
          },
        ],
      }),
      entry(2, { selectedNodeId: 'card-1' }),
    ]);

    const claims = canvasCardClaimants(
      canvasPresenceParticipants(entries, { localClientId: 9 })
    );
    const claimants = claims.get('card-1') ?? [];
    expect(claimants.map((claimant) => claimant.kind)).toEqual([
      'agent',
      'user',
    ]);
    expect(claimants[0].name).toBe('Refactor pass');
    expect(claimants[0].onBehalfOfName).toBe('Greg');
    expect(claimants[1].name).toBe('User 2');
  });

  it('drops every claim carried by a client that disconnected', () => {
    const withPeer = new Map<number, CanvasAwarenessEntry>([
      entry(1, {
        agents: [
          { sessionId: 'sess-a', sessionName: 'A', nodeIds: ['card-1'] },
          { sessionId: 'sess-b', sessionName: 'B', nodeIds: ['card-1'] },
        ],
      }),
    ]);
    expect(
      canvasCardClaimants(canvasPresenceParticipants(withPeer)).get('card-1')
    ).toHaveLength(2);

    // Awareness removes the whole entry when a peer goes away; nothing it was
    // carrying may survive that, and no timer is involved in the removal.
    const withoutPeer = new Map<number, CanvasAwarenessEntry>();
    expect(
      canvasCardClaimants(canvasPresenceParticipants(withoutPeer)).size
    ).toBe(0);
  });

  it('leaves your own selection out but keeps agents you are hosting', () => {
    const entries = new Map<number, CanvasAwarenessEntry>([
      entry(1, {
        selectedNodeId: 'card-1',
        agents: [
          {
            sessionId: 'sess-a',
            sessionName: 'Local session',
            nodeIds: ['card-2'],
          },
        ],
      }),
    ]);
    const claims = canvasCardClaimants(
      canvasPresenceParticipants(entries, { localClientId: 1 })
    );
    expect(claims.has('card-1')).toBe(false);
    expect(claims.get('card-2')?.[0]).toMatchObject({
      kind: 'agent',
      isLocal: true,
    });
  });

  it('compares claim sets by value so an unchanged board does not re-render', () => {
    const build = (): ReadonlyMap<number, CanvasAwarenessEntry> =>
      new Map([
        entry(1, {
          cursor: { x: 0, y: 0 },
          agents: [{ sessionId: 'sess-a', sessionName: 'A', nodeIds: ['c1'] }],
        }),
      ]);
    const first = canvasCardClaimants(canvasPresenceParticipants(build()));
    // Same claims, different cursor: the pointer moved, the claim did not.
    const moved = new Map([
      entry(1, {
        cursor: { x: 40, y: 90 },
        agents: [{ sessionId: 'sess-a', sessionName: 'A', nodeIds: ['c1'] }],
      }),
    ]);
    const second = canvasCardClaimants(canvasPresenceParticipants(moved));

    expect(first).not.toBe(second);
    expect(sameCanvasCardClaimants(first, second)).toBe(true);

    const relabelled = canvasCardClaimants(
      canvasPresenceParticipants(
        new Map([
          entry(1, {
            agents: [
              { sessionId: 'sess-a', sessionName: 'Renamed', nodeIds: ['c1'] },
            ],
          }),
        ])
      )
    );
    expect(sameCanvasCardClaimants(first, relabelled)).toBe(false);
  });
});
