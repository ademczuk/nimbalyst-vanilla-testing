/**
 * A late-bound `decorate()` for decorator nodes whose class must also load
 * where React cannot: the collab worker, the CLI, headless Nimbalyst.
 *
 * Each such node keeps ONE class -- type, serialized shape, markdown import and
 * export -- in a React-free `*Core.ts` module, and its `decorate()` asks a slot
 * like this one. The node's existing `.tsx` module fills the slot and
 * re-exports the core, so every editor import path still gets the React
 * decorator while the headless graph never loads it. With nothing registered,
 * `decorate()` returns null; headless editors never call it.
 *
 * One class rather than a headless twin is the point: a second class with the
 * same `getType()` would be a second serialization to keep in step with the
 * first, and the Y.Docs both write are read by every client.
 */
import type { EditorConfig, LexicalEditor } from 'lexical';
import type { JSX } from 'react';
export type NodeDecorator<N> = (node: N, editor: LexicalEditor, config: EditorConfig) => JSX.Element;
export interface NodeDecoratorSlot<N> {
    set(decorator: NodeDecorator<N> | undefined): void;
    decorate(node: N, editor: LexicalEditor, config: EditorConfig): JSX.Element | null;
}
export declare function createNodeDecoratorSlot<N>(): NodeDecoratorSlot<N>;
