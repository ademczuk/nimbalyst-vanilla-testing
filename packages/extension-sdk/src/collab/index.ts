/**
 * React-free public entry for the collaborative-document helpers.
 *
 * The package root re-exports everything here, but the root barrel also pulls
 * in `useEditorLifecycle` and therefore `react` — a peer dependency the host
 * injects at runtime. A codec or a codec test that only touches `Y.Doc` has no
 * React installed, so importing the root barrel fails to resolve for it.
 * `@nimbalyst/extension-sdk/collab` is the entry those consumers import
 * instead, so nobody has to reach into `dist/` by path.
 */
export { COLLAB_INIT_ORIGIN } from './origins.js';

export {
  createTextCollabContentAdapter,
  reconstructCollabContentAdapterFromDescriptor,
  TEXT_COLLAB_DEFAULT_FIELD,
  type TextCollabContentAdapterOptions,
} from './createTextCollabContentAdapter.js';

export {
  applyTextDiff,
  replaceYText,
  type ApplyTextEdit,
} from './textReplacement.js';
