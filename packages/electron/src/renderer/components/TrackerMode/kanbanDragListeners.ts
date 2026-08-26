/** Desktop compatibility shim; the browser and renderer share one DOM contract. */
export {
  registerKanbanDragCallbacks,
  resolveDropIndex,
} from '@nimbalyst/collab-client/trackers-ui';
export type {
  KanbanCardHit,
  KanbanDragCallbacks,
  KanbanDragOverCallback,
  KanbanDropCallback,
} from '@nimbalyst/collab-client/trackers-ui';
