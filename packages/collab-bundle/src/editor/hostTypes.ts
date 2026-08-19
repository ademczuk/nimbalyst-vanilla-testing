/**
 * The SDK editor contract, re-exported so the published declarations can carry
 * it verbatim.
 *
 * `types/editor.d.ts` is hand-authored, and hand-copying `EditorHost` into it
 * would put a 900-line interface in two places that must agree forever. Instead
 * this module is a declaration-only entry point: `tsconfig.types.json` compiles
 * it, so `types/internal/extension-sdk/**` holds the real declarations, and the
 * public entry re-exports from there -- exactly how the runtime's JWT brands
 * already reach consumers.
 *
 * Type-only on purpose. `check-collab-bundle.mjs` forbids the extension SDK
 * from entering the browser runtime graph, and every import here is erased.
 */

export type {
  CollaborationContext,
  CollaborationStatus,
  CollaboratorInfo,
  EditorContext,
  EditorContextItem,
  EditorHost,
  EditorHostCapabilities,
  EditorHostCapability,
  EditorHostCapabilityGap,
  EditorHostFileSystem,
  EditorHostProps,
  EditorMenuItem,
  RevisionSnapshotAdapter,
  StandardAwarenessState,
} from '@nimbalyst/extension-sdk/types/editor';

export type { ExtensionStorage } from '@nimbalyst/extension-sdk/types/panel';
