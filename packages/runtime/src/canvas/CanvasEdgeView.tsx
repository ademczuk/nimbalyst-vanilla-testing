/**
 * Canvas edge: a smooth-step arrow with an optional label.
 *
 * JSON Canvas edges carry `fromEnd` / `toEnd` ("none" or "arrow"), so the
 * marker on each end is data rather than a style choice. An edge with no ends
 * declared gets the spec's default: plain at the source, arrow at the target.
 */
import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

import { canvasColorValue } from './CanvasCardNode';
import type { CanvasEdgeData, CanvasFlowEdge } from './canvasFlowMapping';

/** Marker ids defined once by the surface's inline `<defs>`. */
export const CANVAS_EDGE_ARROW_MARKER = 'nim-canvas-arrow';
export const CANVAS_EDGE_ARROW_START_MARKER = 'nim-canvas-arrow-start';

export const CanvasEdgeView = memo(function CanvasEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}: EdgeProps<CanvasFlowEdge>) {
  const edge = (data as CanvasEdgeData | undefined)?.edge;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 12,
  });

  const color = canvasColorValue(edge?.color);
  const stroke = selected
    ? 'var(--nim-primary)'
    : color ?? 'var(--nim-text-faint)';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className="canvas-edge"
        style={{ stroke, strokeWidth: selected ? 2.5 : 1.5 }}
        markerStart={
          edge?.fromEnd === 'arrow'
            ? `url(#${CANVAS_EDGE_ARROW_START_MARKER})`
            : undefined
        }
        markerEnd={
          edge?.toEnd === 'none'
            ? undefined
            : `url(#${CANVAS_EDGE_ARROW_MARKER})`
        }
      />
      {edge?.label ? (
        <EdgeLabelRenderer>
          <div
            className="canvas-edge__label select-text"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {edge.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});
