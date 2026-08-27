/**
 * `.mockupproject` -> `.canvas` conversion, as a pure function.
 *
 * SOURCE OF TRUTH for the input shape is `MockupProjectFile` in
 * `packages/extensions/mockuplm/src/types/project.ts`. `MockupProjectCanvasSource`
 * below is a deliberate structural copy of it, not an import: the runtime must
 * not take a build- or type-dependency on an extension, and extensions ship and
 * version independently of the runtime. The copy is intentionally *looser* than
 * the original -- every collection and the viewport are optional here, so a
 * hand-edited or older project file converts instead of throwing. Keep this in
 * sync when the MockupLM project format gains a field worth carrying over.
 */
import {
  NIMBALYST_CANVAS_NAMESPACE,
  createEmptyCanvasDocument,
  toCanvasCoordinate,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasFileNode,
} from './CanvasDocument';

export interface MockupProjectCanvasSource {
  version?: 1;
  name?: string;
  description?: string;
  designSystem?: {
    styleGuide?: string;
    theme?: string;
    [key: string]: unknown;
  };
  mockups?: Array<{
    id: string;
    path: string;
    label?: string;
    position?: { x: number; y: number };
    size?: { width: number; height: number };
  }>;
  connections?: Array<{
    id: string;
    fromMockupId: string;
    toMockupId: string;
    fromElementSelector?: string;
    label?: string;
    trigger?: 'click' | 'hover' | 'navigate';
  }>;
  viewport?: { x: number; y: number; zoom: number };
  [key: string]: unknown;
}

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 } as const;
const DEFAULT_CARD_SIZE = { width: 400, height: 300 } as const;

export function convertMockupProjectToCanvas(
  json: MockupProjectCanvasSource | string
): CanvasDocument {
  const project =
    typeof json === 'string'
      ? (JSON.parse(json) as MockupProjectCanvasSource)
      : json;

  const canvas = createEmptyCanvasDocument({
    name: project.name ?? 'Untitled project',
    ...(project.description !== undefined
      ? { description: project.description }
      : {}),
    viewport: { ...DEFAULT_VIEWPORT, ...project.viewport },
    ...(project.designSystem !== undefined
      ? { designSystem: { ...project.designSystem } }
      : {}),
  });

  canvas.nodes = (project.mockups ?? []).map(convertMockup);
  canvas.edges = (project.connections ?? []).map(convertConnection);
  return canvas;
}

function convertMockup(
  mockup: NonNullable<MockupProjectCanvasSource['mockups']>[number]
): CanvasFileNode {
  const position = mockup.position ?? { x: 0, y: 0 };
  const size = mockup.size ?? DEFAULT_CARD_SIZE;

  return {
    id: mockup.id,
    type: 'file',
    x: toCanvasCoordinate(position.x),
    y: toCanvasCoordinate(position.y),
    width: toCanvasCoordinate(size.width),
    height: toCanvasCoordinate(size.height),
    file: mockup.path,
    [NIMBALYST_CANVAS_NAMESPACE]: {
      reference: { kind: 'file', path: mockup.path },
      label: mockup.label ?? basename(mockup.path),
    },
  };
}

function convertConnection(
  connection: NonNullable<MockupProjectCanvasSource['connections']>[number]
): CanvasEdge {
  const hasFlowDetail =
    connection.fromElementSelector !== undefined ||
    connection.trigger !== undefined;
  return {
    id: connection.id,
    fromNode: connection.fromMockupId,
    toNode: connection.toMockupId,
    ...(connection.label !== undefined ? { label: connection.label } : {}),
    [NIMBALYST_CANVAS_NAMESPACE]: {
      kind: 'flow',
      ...(hasFlowDetail
        ? {
            flow: {
              ...(connection.fromElementSelector !== undefined
                ? { fromElementSelector: connection.fromElementSelector }
                : {}),
              ...(connection.trigger !== undefined
                ? { trigger: connection.trigger }
                : {}),
            },
          }
        : {}),
    },
  };
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}
