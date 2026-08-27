/**
 * Project Canvas, as consumed by a browser host.
 *
 * Hand-authored, for the reason `editor.d.ts` is: generating this entry would
 * emit the runtime canvas declarations, and those re-export the extension SDK
 * by its bare package name through `runtime/src/extensions/editorHost` --
 * a specifier a consumer of this package does not install and cannot resolve.
 * `src/test/public-canvas-typecheck.ts` is what stops this drifting from the
 * implementation it describes.
 *
 * `EditorHostProps` is NOT restated here. It is the SDK's own declaration, the
 * same one `editor.d.ts` publishes, so `CanvasEditor` is mountable through
 * `mountExtensionEditor` without a cast -- which is the whole point of shipping
 * the canvas this way.
 */

import type { ReactElement } from 'react';
import type { ComponentType } from 'react';
import type { Doc } from 'yjs';
import type { EditorHostProps } from './internal/extension-sdk/src/types/editor';

/** A shared document a card points at, optionally pinned to one revision. */
export interface CanvasDocumentTarget {
  uri: `nimbalyst://doc/${string}/${string}`;
  revisionId?: string;
  [key: string]: unknown;
}

/**
 * A workspace file. Desktop-only content: a browser has no filesystem, so a
 * host that cannot resolve one must say so on the card rather than drop it.
 * `sharedAs` is the binding written when the file is promoted to a shared
 * document, and is what lets the same board work in both hosts.
 */
export interface CanvasFileReference {
  kind: 'file';
  path: string;
  sharedAs?: CanvasDocumentTarget;
  [key: string]: unknown;
}

export interface CanvasDocReference extends CanvasDocumentTarget {
  kind: 'doc';
}

/** The two reference kinds that resolve to a real editor. */
export type CanvasCardReference = CanvasFileReference | CanvasDocReference;

export interface CanvasCardRenderProps {
  /** Canvas node id. Stable across moves; useful as a mount key. */
  nodeId: string;
  reference: CanvasCardReference;
  /** Display name for chrome and error states. May be empty. */
  label: string;
  /**
   * `warm` -- mount read-only, no editing affordances, pointer-inert.
   * `hot` -- editable and focusable; the viewport is at scale 1.0.
   *
   * A host must treat this as a property change, not a remount: warming and
   * heating the same card must not tear down its editor or its room.
   */
  detail: 'warm' | 'hot';
}

export interface CanvasCallbacks {
  /**
   * Mounts the real editor for a `file` or `doc` card. When undefined, the
   * canvas falls back to a labelled placeholder naming what the card points at.
   */
  renderCard?: ComponentType<CanvasCardRenderProps>;
}

export declare function getCanvasCallbacks(): CanvasCallbacks;
export declare function setCanvasCallbacks(next: CanvasCallbacks): void;

/**
 * The `.canvas` codec, narrowed to the file/Y.Doc surface a browser host uses.
 *
 * The optional structured, comment-anchor and revision members of the SDK's
 * `CollabCodec` are deliberately absent: publishing them would mean restating
 * `CommentAnchor` and the rest of the SDK's collab types by hand, and no
 * browser host reads them -- the console's own registry narrows a codec to
 * very nearly this.
 */
export interface CanvasCollabCodec {
  documentType: string;
  fileExtensions: string[];
  layoutVersion: number;
  isEmpty(yDoc: Doc): boolean;
  seedFromFile(yDoc: Doc, source: string | Uint8Array): void;
  applyFromFile(yDoc: Doc, source: string | Uint8Array): void;
  exportToFile(yDoc: Doc): string | Uint8Array;
  toPlainText(yDoc: Doc): string;
}

export declare const canvasCollabCodec: CanvasCollabCodec;

/** The board itself, over the same `EditorHost` contract an extension gets. */
export declare function CanvasEditor(props: EditorHostProps): ReactElement;
