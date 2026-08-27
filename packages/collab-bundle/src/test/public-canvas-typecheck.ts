/**
 * `types/canvas.d.ts` is hand-authored (see its header), so nothing but a
 * compile-time assertion stops it drifting from the runtime canvas module it
 * describes.
 *
 * The codec assertion is deliberately one-directional. The published codec type
 * is a documented *narrowing* of the SDK's `CollabCodec` -- it omits the
 * optional structured/comment-anchor/revision members -- so only "the real
 * codec satisfies the published type" is a true statement. The per-member
 * assignments below are what actually catch drift: they compare the four
 * signatures a browser host calls, in both directions, so a changed parameter
 * or return type fails here rather than at the console's mount.
 */

import {
  canvasCollabCodec as publicCanvasCollabCodec,
  getCanvasCallbacks as publicGetCanvasCallbacks,
  setCanvasCallbacks as publicSetCanvasCallbacks,
  CanvasEditor as PublicCanvasEditor,
  type CanvasCallbacks as PublicCanvasCallbacks,
  type CanvasCardReference as PublicCanvasCardReference,
  type CanvasCardRenderProps as PublicCanvasCardRenderProps,
  type CanvasCollabCodec as PublicCanvasCollabCodec,
} from '@nimbalyst/collab-bundle/canvas';
import type { ExtensionEditorComponent } from '@nimbalyst/collab-bundle/editor';

import { CanvasEditor } from '@nimbalyst/runtime/canvas/CanvasEditor';
import {
  canvasCollabCodec,
  getCanvasCallbacks,
  setCanvasCallbacks,
  type CanvasCallbacks,
  type CanvasCardReference,
  type CanvasCardRenderProps,
} from '@nimbalyst/runtime/canvas';

const editorForward: typeof PublicCanvasEditor = CanvasEditor;
const editorBack: typeof CanvasEditor = PublicCanvasEditor;

// The published board must mount through the same seam a pinned extension does,
// without a cast. If `EditorHostProps` ever became a look-alike copy rather
// than the SDK's own declaration, this is what would stop compiling.
const mountableBoard: ExtensionEditorComponent = PublicCanvasEditor;

const getForward: typeof publicGetCanvasCallbacks = getCanvasCallbacks;
const getBack: typeof getCanvasCallbacks = publicGetCanvasCallbacks;
const setForward: typeof publicSetCanvasCallbacks = setCanvasCallbacks;
const setBack: typeof setCanvasCallbacks = publicSetCanvasCallbacks;

declare const publicCallbacks: PublicCanvasCallbacks;
declare const sourceCallbacks: CanvasCallbacks;
const callbacksForward: PublicCanvasCallbacks = sourceCallbacks;
const callbacksBack: CanvasCallbacks = publicCallbacks;

declare const publicReference: PublicCanvasCardReference;
declare const sourceReference: CanvasCardReference;
const referenceForward: PublicCanvasCardReference = sourceReference;
const referenceBack: CanvasCardReference = publicReference;

declare const publicRenderProps: PublicCanvasCardRenderProps;
declare const sourceRenderProps: CanvasCardRenderProps;
const renderPropsForward: PublicCanvasCardRenderProps = sourceRenderProps;
const renderPropsBack: CanvasCardRenderProps = publicRenderProps;

const codecSatisfiesPublished: PublicCanvasCollabCodec = canvasCollabCodec;
declare const publicCodec: PublicCanvasCollabCodec;
const isEmptyForward: typeof canvasCollabCodec.isEmpty = publicCodec.isEmpty;
const isEmptyBack: typeof publicCanvasCollabCodec.isEmpty = canvasCollabCodec.isEmpty;
const seedForward: typeof canvasCollabCodec.seedFromFile = publicCodec.seedFromFile;
const seedBack: typeof publicCanvasCollabCodec.seedFromFile = canvasCollabCodec.seedFromFile;
const applyForward: typeof canvasCollabCodec.applyFromFile = publicCodec.applyFromFile;
const applyBack: typeof publicCanvasCollabCodec.applyFromFile = canvasCollabCodec.applyFromFile;
const exportForward: typeof canvasCollabCodec.exportToFile = publicCodec.exportToFile;
const exportBack: typeof publicCanvasCollabCodec.exportToFile = canvasCollabCodec.exportToFile;
const plainTextForward: typeof canvasCollabCodec.toPlainText = publicCodec.toPlainText;
const plainTextBack: typeof publicCanvasCollabCodec.toPlainText = canvasCollabCodec.toPlainText;

void editorForward;
void editorBack;
void mountableBoard;
void getForward;
void getBack;
void setForward;
void setBack;
void callbacksForward;
void callbacksBack;
void referenceForward;
void referenceBack;
void renderPropsForward;
void renderPropsBack;
void codecSatisfiesPublished;
void isEmptyForward;
void isEmptyBack;
void seedForward;
void seedBack;
void applyForward;
void applyBack;
void exportForward;
void exportBack;
void plainTextForward;
void plainTextBack;
