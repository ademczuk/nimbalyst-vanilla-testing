/**
 * Format and codec only.
 *
 * `CanvasSurface` / `CanvasEditor` are deliberately NOT re-exported here: this
 * barrel is imported at renderer startup to register the collab codec, and
 * exporting the surface would drag `@xyflow/react` and the whole card tree into
 * that path. Import them from `@nimbalyst/runtime/canvas/CanvasEditor`.
 */
export * from './CanvasDocument';
export * from './canvasRank';
export * from './canvasBinding';
export * from './canvasFlowMapping';
export * from './canvasCardLod';
export * from './canvasSnapping';
export * from './canvasPresence';
export * from './canvasCommentAnchors';
export * from './canvasComments';
export * from './canvasRevisions';
export {
  getCanvasCallbacks,
  setCanvasCallbacks,
  type CanvasAgentDispatch,
  type CanvasCallbacks,
  type CanvasCardCommentSource,
  type CanvasCardPick,
  type CanvasCardReference,
  type CanvasCardRenderProps,
  type CanvasDropSource,
} from './canvasCallbacks';
export {
  CANVAS_EXTRAS_NAMESPACE,
  CANVAS_EXTRAS_TOP_LEVEL,
  CANVAS_Y_EDGES,
  CANVAS_Y_EXTRAS,
  CANVAS_Y_META,
  CANVAS_Y_NODES,
  canvasCollabCodec,
  getCanvasYEdges,
  getCanvasYExtras,
  getCanvasYMeta,
  getCanvasYNodes,
  readCanvasDocumentFromYDoc,
} from './canvasCollabCodec';
export {
  convertMockupProjectToCanvas,
  type MockupProjectCanvasSource,
} from './mockupProjectConverter';
