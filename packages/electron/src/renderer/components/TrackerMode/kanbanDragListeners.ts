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

/**
 * The only thing the drop-index math reads off a card. Narrower than
 * `HTMLElement` on purpose, so the decision is testable without a DOM -- the
 * live branch could otherwise only ever run inside a real drag.
 */
export interface KanbanCardHit {
  dataset: { cardIndex?: string };
  getBoundingClientRect(): { top: number; height: number };
}

/**
 * Where a drop at `clientY` lands, as an index into the column's *full* item
 * list.
 *
 * The column is virtualized, so `cards` holds only the rows mounted near the
 * viewport: a card's position in this array is not its position in the column.
 * The real index rides on the element as `data-card-index`, and array position
 * is only a fallback for a card rendered without one.
 */
export function resolveDropIndex(cards: readonly KanbanCardHit[], clientY: number): number {
  const indexOf = (card: KanbanCardHit, fallback: number) => {
    const parsed = Number(card.dataset.cardIndex);
    return Number.isInteger(parsed) ? parsed : fallback;
  };
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return indexOf(cards[i], i);
  }
  // Below every rendered card, the drop belongs directly after the last one --
  // which is where the pointer is, not the end of a column the user cannot see.
  return cards.length ? indexOf(cards[cards.length - 1], cards.length - 1) + 1 : 0;
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
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.tracker-kanban-card'));
    _kanbanDragOverCb?.(columnKey, resolveDropIndex(cards, e.clientY));
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
