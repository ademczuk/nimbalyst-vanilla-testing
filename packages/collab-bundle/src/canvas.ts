/**
 * Project Canvas, as a browser entry.
 *
 * The runtime canvas module is host-agnostic by construction -- it resolves no
 * extension, reads no file and opens no room, deferring all three to the
 * `setCanvasCallbacks({ renderCard })` slot. That is what makes a second host
 * possible at all, and this entry is the whole of what the second host needs:
 * the editor component, the codec that names the `.canvas` document type, and
 * the slot to fill.
 *
 * Kept as its own entry rather than folded into `./editor`. A board drags
 * `@xyflow/react` and the entire card tree behind it, and most sessions never
 * open one; the console imports this lazily, exactly as it imports a pinned
 * extension's bundle. `./editor` is eager on the document route and must not
 * grow a React Flow graph it cannot shed.
 *
 * The card renderer is deliberately NOT exported from here. It belongs to the
 * host -- desktop mounts through `EmbedFrame`'s resolution, the console through
 * `ExtensionEditorMount` -- and a renderer shipped in this bundle would be a
 * third host neither of them asked for.
 */

export { CanvasEditor } from '@nimbalyst/runtime/canvas/CanvasEditor';
export {
  canvasCollabCodec,
  getCanvasCallbacks,
  setCanvasCallbacks,
  type CanvasCallbacks,
  type CanvasCardReference,
  type CanvasCardRenderProps,
  type CanvasDocReference,
  type CanvasDocumentTarget,
  type CanvasFileReference,
} from '@nimbalyst/runtime/canvas';
