/**
 * TrackerReferenceNode — an inline reference (pointer) to a tracker item.
 *
 * Unlike `TrackerItemNode` (which embeds a frozen snapshot of an item inline),
 * this node stores ONLY the reference key (e.g. `NIM-123`). The decorated chip
 * resolves the item's title/status *live* at render time via the injected
 * {@link TrackerReferenceResolver}, so editing or closing the item elsewhere
 * updates every chip pointing at it with no document edit.
 *
 * Serializes to a portable markdown link `[NIM-123](nimbalyst://NIM-123)` via
 * {@link TrackerReferenceTransformer}, so the document stays valid markdown and
 * degrades to a plain link in any other viewer.
 */
import type { DOMConversionMap, DOMExportOutput, EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import type { JSX } from 'react';
import { DecoratorNode } from 'lexical';
export declare const TRACKER_REFERENCE_URN_SCHEME = "nimbalyst://";
export type TrackerReferenceView = 'chip' | 'card' | 'statements';
export declare function normalizeTrackerReferenceView(view: unknown): TrackerReferenceView;
export type SerializedTrackerReferenceNode = Spread<{
    /** Reference key: an issue key (NIM-123) or local short id (tk_abc123). */
    referenceKey: string;
    view?: TrackerReferenceView;
}, SerializedLexicalNode>;
export declare class TrackerReferenceNode extends DecoratorNode<JSX.Element> {
    __referenceKey: string;
    __view: TrackerReferenceView;
    static getType(): string;
    static clone(node: TrackerReferenceNode): TrackerReferenceNode;
    static importJSON(serializedNode: SerializedTrackerReferenceNode): TrackerReferenceNode;
    constructor(referenceKey: string, key?: NodeKey, view?: TrackerReferenceView);
    exportJSON(): SerializedTrackerReferenceNode;
    createDOM(config: EditorConfig): HTMLElement;
    updateDOM(prev: TrackerReferenceNode): boolean;
    exportDOM(): DOMExportOutput;
    static importDOM(): DOMConversionMap | null;
    decorate(): JSX.Element;
    isInline(): true;
    /** Plain-text fallback (copy, non-rich serialization) is the bare key. */
    getTextContent(): string;
    getReferenceKey(): string;
    getView(): TrackerReferenceView;
    setView(view: TrackerReferenceView): this;
}
export declare function $createTrackerReferenceNode(referenceKey: string, view?: TrackerReferenceView): TrackerReferenceNode;
export declare function $isTrackerReferenceNode(node: LexicalNode | null | undefined): node is TrackerReferenceNode;
