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
    dataset: {
        cardIndex?: string;
    };
    getBoundingClientRect(): {
        top: number;
        height: number;
    };
}
/**
 * Resolve a pointer position to an index in the column's full item list.
 *
 * A virtualized column exposes only mounted cards. Their array position is not
 * their column position, so the real index must come from `data-card-index`.
 */
export declare function resolveDropIndex(cards: readonly KanbanCardHit[], clientY: number): number;
/** Point the document listeners at the mounted board; returns the detach. */
export declare function registerKanbanDragCallbacks(callbacks: KanbanDragCallbacks): () => void;
