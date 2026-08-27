// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  CANVAS_NODE_RANK_FIELD,
  NIMBALYST_CANVAS_NAMESPACE,
  canvasRankBetween,
  parseCanvasDocument,
  serializeCanvasDocument,
  type CanvasAnyNode,
  type CanvasDocument,
} from '../CanvasDocument';
import {
  applyCanvasNodeChanges,
  canvasCardKind,
  toFlowNodes,
} from '../canvasFlowMapping';

function card(
  id: string,
  overrides: Partial<CanvasAnyNode> = {}
): CanvasAnyNode {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    text: id,
    ...overrides,
  } as CanvasAnyNode;
}

describe('canvas <-> React Flow mapping', () => {
  it('derives zIndex from rank order, falling back to file array order', () => {
    // No ranks: the file's array order is the z-order, exactly as the spec says.
    const fromFile: CanvasDocument = {
      nodes: [card('bottom'), card('middle'), card('top')],
    };
    expect(toFlowNodes(fromFile).map((node) => [node.id, node.zIndex])).toEqual(
      [
        ['bottom', 0],
        ['middle', 1],
        ['top', 2],
      ]
    );

    // Ranked (the shape the collaborative document uses): rank decides, and a
    // node whose rank lands between two others paints between them -- even
    // though it sits last in the array, which is what a concurrent insert
    // produces.
    const low = canvasRankBetween(null, null);
    const high = canvasRankBetween(low, null);
    const ranked: CanvasDocument = {
      nodes: [
        card('bottom', { [CANVAS_NODE_RANK_FIELD]: low }),
        card('top', { [CANVAS_NODE_RANK_FIELD]: high }),
        card('inserted', {
          [CANVAS_NODE_RANK_FIELD]: canvasRankBetween(low, high),
        }),
      ],
    };
    expect(toFlowNodes(ranked).map((node) => node.id)).toEqual([
      'bottom',
      'inserted',
      'top',
    ]);
  });

  it('rounds dragged geometry, carries a frame’s contents, and leaves everything else alone', () => {
    const before: CanvasDocument = {
      nodes: [
        card('frame', { type: 'group', x: 0, y: 0, width: 600, height: 400 }),
        card('inside', { x: 20, y: 20 }),
        card('outside', { x: 900, y: 900 }),
      ],
    };

    const after = applyCanvasNodeChanges(before, [
      {
        id: 'inside',
        type: 'position',
        position: { x: 40.4, y: 60.6 },
        dragging: true,
      },
      { id: 'inside', type: 'select', selected: true },
    ]);
    expect(after.nodes?.[1]).toMatchObject({ x: 40, y: 61 });
    // Untouched nodes keep identity: a drag must not dirty the rest of the board.
    expect(after.nodes?.[0]).toBe(before.nodes?.[0]);
    expect(after.nodes?.[2]).toBe(before.nodes?.[2]);
    // Selection is view state and never reaches the document.
    expect(after.nodes?.[1]).not.toHaveProperty('selected');

    // Dragging the frame moves what it encloses and nothing else.
    const moved = applyCanvasNodeChanges(before, [
      { id: 'frame', type: 'position', position: { x: 100, y: 50 } },
    ]);
    expect(moved.nodes?.[0]).toMatchObject({ x: 100, y: 50 });
    expect(moved.nodes?.[1]).toMatchObject({ x: 120, y: 70 });
    expect(moved.nodes?.[2]).toBe(before.nodes?.[2]);

    // React Flow reports measured dimensions after every render; honouring
    // those would dirty a board nobody edited.
    expect(
      applyCanvasNodeChanges(before, [
        {
          id: 'inside',
          type: 'dimensions',
          dimensions: { width: 201, height: 99 },
        },
      ])
    ).toBe(before);
    expect(
      applyCanvasNodeChanges(before, [
        {
          id: 'inside',
          type: 'dimensions',
          dimensions: { width: 300.2, height: 150.8 },
          setAttributes: true,
        },
      ]).nodes?.[1]
    ).toMatchObject({ width: 300, height: 151 });

    // Removing a node takes its edges with it, and only its edges.
    const connected: CanvasDocument = {
      ...before,
      edges: [
        { id: 'a', fromNode: 'inside', toNode: 'outside' },
        { id: 'b', fromNode: 'frame', toNode: 'outside' },
      ],
    };
    const pruned = applyCanvasNodeChanges(connected, [
      { id: 'inside', type: 'remove' },
    ]);
    expect(pruned.nodes?.map((node) => node.id)).toEqual(['frame', 'outside']);
    expect(pruned.edges?.map((edge) => edge.id)).toEqual(['b']);
  });

  it('survives a load, edit, and save cycle with an unknown node type intact', () => {
    const source = serializeCanvasDocument({
      nodes: [
        {
          id: 'foreign',
          type: 'mermaid',
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          source: 'graph TD',
        },
        card('note', {
          x: 400,
          [NIMBALYST_CANVAS_NAMESPACE]: {
            reference: { kind: 'native', nativeKind: 'sticky' },
          },
        }),
      ],
      edges: [],
    });

    const loaded = parseCanvasDocument(source);
    // The card renders as a labelled placeholder rather than vanishing.
    expect(canvasCardKind(loaded.nodes![0])).toBe('unsupported');
    expect(canvasCardKind(loaded.nodes![1])).toBe('sticky');

    const edited = applyCanvasNodeChanges(loaded, [
      { id: 'note', type: 'position', position: { x: 410.5, y: 0 } },
    ]);
    const saved = JSON.parse(serializeCanvasDocument(edited));
    expect(saved.nodes[0]).toEqual(JSON.parse(source).nodes[0]);
    expect(saved.nodes[1].x).toBe(411);
  });

  /*
   * The regression NIM-3845 actually leaves behind. Popover and Monaco maths
   * measured correct at every scale; what does not survive is an *interactive*
   * card sitting under a scale transform -- RevoGrid's hit-testing is wrong by
   * `d_local * (k - 1)` with no scale floor to sit above.
   *
   * Activation animates to 1.0, so the card is fine at the moment it goes hot.
   * The hazard is everything that changes the zoom *afterwards*: the Controls
   * zoom buttons, ctrl+wheel over the pane, the minimap, `fitView`. None of
   * those consult the activation state. So the gate lives here, at the single
   * function that decides which card is hot, rather than in a handler another
   * zoom path could forget to call.
   */
  it('never reports a card as active while the viewport is scaled', () => {
    const document: CanvasDocument = { nodes: [card('a'), card('b')] };
    const activeOf = (nodes: ReturnType<typeof toFlowNodes>) =>
      nodes.filter((node) => node.data.active).map((node) => node.id);

    // At (and within tolerance of) 1.0 the card is hot and owns the pointer.
    expect(
      activeOf(toFlowNodes(document, { activeNodeId: 'a', zoom: 1 }))
    ).toEqual(['a']);
    expect(
      activeOf(toFlowNodes(document, { activeNodeId: 'a', zoom: 0.99 }))
    ).toEqual(['a']);

    // Zoomed away from 1.0 the card goes inert again, whatever asked for it.
    for (const zoom of [0.5, 0.9, 1.5, 2]) {
      const nodes = toFlowNodes(document, { activeNodeId: 'a', zoom });
      expect(activeOf(nodes)).toEqual([]);
      // ...and it becomes draggable/selectable again, so the board stays usable
      // rather than leaving one card stuck in a half-activated state.
      const card_a = nodes.find((node) => node.id === 'a')!;
      expect(card_a.draggable).toBe(true);
      expect(card_a.selectable).toBe(true);
    }

    // An omitted zoom means "the caller is not driving a viewport" (the codec,
    // a test, a static export) and must not silently disable activation.
    expect(activeOf(toFlowNodes(document, { activeNodeId: 'a' }))).toEqual([
      'a',
    ]);
  });
});
