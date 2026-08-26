/**
 * The board's native HTML5 drag-and-drop plumbing.
 *
 * The listeners live on `document` and are attached exactly once so they
 * survive HMR; the mounted board swaps the callbacks they invoke. The DOM
 * contract is the card/column class names, not React props, so this module is
 * deliberately React-free and shared by desktop and browser hosts.
 */

export type KanbanDropCallback = (targetColumnKey: string, dropIdx: number) => void;
export type KanbanDragOverCallback = (columnKey: string, dropIdx: number) => void;

export interface KanbanDragCallbacks {
  onDrop: KanbanDropCallback;
  onDragOver: KanbanDragOverCallback;
  onDragLeave: () => void;
}

/** The only card DOM state the drop-index calculation reads. */
export interface KanbanCardHit {
  dataset: { cardIndex?: string };
  getBoundingClientRect(): { top: number; height: number };
}

/**
 * Resolve a pointer position to an index in the column's full item list.
 *
 * A virtualized column exposes only mounted cards. Their array position is not
 * their column position, so the real index must come from `data-card-index`.
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
  return cards.length ? indexOf(cards[cards.length - 1], cards.length - 1) + 1 : 0;
}

let kanbanDropCallback: KanbanDropCallback | null = null;
let kanbanDragOverCallback: KanbanDragOverCallback | null = null;
let kanbanDragLeaveCallback: (() => void) | null = null;
let listenersAttached = false;

function ensureKanbanDragListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  document.addEventListener('dragover', (event: DragEvent) => {
    const column = (event.target as HTMLElement)?.closest?.('.tracker-kanban-column') as HTMLElement | null;
    if (!column) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const columnKey = column.dataset.columnKey;
    if (!columnKey) return;
    const container = column.querySelector('.kanban-cards-container');
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLElement>('.tracker-kanban-card'));
    kanbanDragOverCallback?.(columnKey, resolveDropIndex(cards, event.clientY));
  });

  document.addEventListener('drop', (event: DragEvent) => {
    if (!(event.target as HTMLElement)?.closest?.('.tracker-kanban-board')) return;
    event.preventDefault();
    const column = (event.target as HTMLElement)?.closest?.('.tracker-kanban-column') as HTMLElement | null;
    kanbanDropCallback?.(column?.dataset.columnKey ?? '', -1);
  });

  document.addEventListener('dragleave', (event: DragEvent) => {
    const column = (event.target as HTMLElement)?.closest?.('.tracker-kanban-column');
    if (column && !column.contains(event.relatedTarget as Node)) kanbanDragLeaveCallback?.();
  });
}

/** Point the document listeners at the mounted board; returns the detach. */
export function registerKanbanDragCallbacks(callbacks: KanbanDragCallbacks): () => void {
  ensureKanbanDragListeners();
  kanbanDropCallback = callbacks.onDrop;
  kanbanDragOverCallback = callbacks.onDragOver;
  kanbanDragLeaveCallback = callbacks.onDragLeave;
  return () => {
    kanbanDropCallback = null;
    kanbanDragOverCallback = null;
    kanbanDragLeaveCallback = null;
  };
}
