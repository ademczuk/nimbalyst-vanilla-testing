/**
 * Re-export useCollaborativeEditor from the extension SDK.
 * The canonical implementation lives in @nimbalyst/extension-sdk.
 * Runtime re-exports it so existing internal imports continue to work,
 * including binding an already-hydrated local replica while offline.
 */
export {
  useCollaborativeEditor,
  COLLAB_INIT_ORIGIN,
  type UseCollaborativeEditorConfig,
  type UseCollaborativeEditorResult,
} from '@nimbalyst/extension-sdk';
