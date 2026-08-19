/**
 * The board's drag-and-drop plumbing.
 *
 * The listeners live on `document` and are attached exactly once so they survive
 * HMR; the mounted board swaps the callbacks they invoke. Extracted from
 * KanbanBoard unchanged -- the DOM contract is the card/column class names, not
 * React props, so this module is deliberately React-free.
 */

export type KanbanDropCallback = (targetColumnKey: string, dropIdx: number) => void;
export type KanbanDragOverCallback = (columnKey: string, dropIdx: number) => void;

export interface KanbanDragCallbacks {
  onDrop: KanbanDropCallback;
  onDragOver: KanbanDragOverCallback;
  onDragLeave: () => void;
}

let _kanbanDropCb: KanbanDropCallback | null = null;
let _kanbanDragOverCb: KanbanDragOverCallback | null = null;
let _kanbanDragLeaveCb: (() => void) | null = null;
let _listenersAttached = false;

function ensureKanbanDragListeners() {
  if (_listenersAttached) return;
  _listenersAttached = true;

  document.addEventListener('dragover', (e: DragEvent) => {
    const colEl = (e.target as HTMLElement)?.closest?.('.tracker-kanban-column') as HTMLElement | null;
    if (!colEl) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    const columnKey = colEl.dataset.columnKey;
    if (!columnKey) return;

    const container = colEl.querySelector('.kanban-cards-container');
    if (!container) return;
    const cards = Array.from(container.querySelectorAll('.tracker-kanban-card'));
    let idx = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { idx = i; break; }
    }

    _kanbanDragOverCb?.(columnKey, idx);
  });

  document.addEventListener('drop', (e: DragEvent) => {
    if (!(e.target as HTMLElement)?.closest?.('.tracker-kanban-board')) return;
    e.preventDefault();
    const colEl = (e.target as HTMLElement)?.closest?.('.tracker-kanban-column') as HTMLElement | null;
    // dropIdx is set by the last dragover; read from the component via callback
    _kanbanDropCb?.(colEl?.dataset?.columnKey || '', -1);
  });

  document.addEventListener('dragleave', (e: DragEvent) => {
    const colEl = (e.target as HTMLElement)?.closest?.('.tracker-kanban-column');
    if (colEl && !colEl.contains(e.relatedTarget as Node)) {
      _kanbanDragLeaveCb?.();
    }
  });
}

/** Point the document listeners at a mounted board; returns the detach. */
export function registerKanbanDragCallbacks(callbacks: KanbanDragCallbacks): () => void {
  ensureKanbanDragListeners();
  _kanbanDropCb = callbacks.onDrop;
  _kanbanDragOverCb = callbacks.onDragOver;
  _kanbanDragLeaveCb = callbacks.onDragLeave;
  return () => {
    _kanbanDropCb = null;
    _kanbanDragOverCb = null;
    _kanbanDragLeaveCb = null;
  };
}
