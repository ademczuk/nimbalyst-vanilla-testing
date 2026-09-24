export { mountCollabEditor } from './mount';
export { resolveCollabEditorUser } from './presence';

// Extension-provided editors. The Lexical mount above is one tenant of the
// collaborative session; this is the generic one, for editors an extension
// bundle supplies. See `browserEditorCapabilities` for what a browser host
// can and cannot do for them.
export { mountExtensionEditor } from './mountExtensionEditor';
export type {
  ExtensionEditorComponent,
  ExtensionEditorHandle,
  ExtensionEditorMountOptions,
} from './mountExtensionEditor';
export {
  BrowserEditorCapabilityError,
  BROWSER_EDITOR_CAPABILITY_GAPS,
  BROWSER_EDITOR_ENVIRONMENT,
  BROWSER_EDITOR_SUPPORTED_CAPABILITIES,
  createBrowserEditorCapabilities,
  resolveBrowserFilesystemPermission,
} from './browserEditorCapabilities';
export type {
  BrowserEditorGrantedCapabilities,
  BrowserExtensionPermissions,
  BrowserPermissionOutcome,
  EditorHostCapabilities,
  EditorHostCapability,
  EditorHostCapabilityGap,
} from './browserEditorCapabilities';
export {
  browserDocumentPath,
  createBrowserCollaborationContext,
  createBrowserExtensionEditorHost,
  flushBrowserCollaborativeContent,
} from './browserExtensionHost';
export type {
  BrowserCollaborationContextOptions,
  BrowserExtensionEditorHost,
  BrowserExtensionEditorHostOptions,
} from './browserExtensionHost';
// Live tracker reference views. The node renderer registered in
// `./referenceNodes` uses these; hosts reuse them for surfaces outside the
// document (a wiki page's backlinks) under the same resolver context. The
// resolver and its provider come from `./trackers-ui`.
export {
  LiveTrackerReferenceRenderer,
  TrackerReferenceChipView,
  TrackerReferenceResolverProvider,
} from '@nimbalyst/collab-client/trackers-ui/references';
export type {
  LiveTrackerReferenceRendererProps,
  TrackerReferenceViewKind,
} from '@nimbalyst/collab-client/trackers-ui/references';
export { installCollabEditorBridge } from './bridge';
export type {
  BridgeAuthResponse,
  BridgeFlushRequest,
  BridgeMountRequest,
  EditorBridgeMessage,
  InstallEditorBridgeOptions,
  NimbalystEditorBridgeApi,
} from './bridge';
export type {
  CollabEditorConnectionState,
  CollabEditorCommentsOptions,
  CollabEditorFlushResult,
  CollabEditorHandle,
  CollabEditorMountOptions,
  CollabEditorParticipant,
  CollabEditorPresence,
  CollabEditorSource,
  CollabEditorState,
  CollabEditorServerAccess,
  CollabEditorTermination,
  CollabEditorUser,
  CollabEditorWriteRejection,
  CommentMember,
  InMemorySource,
  ResolvedCollabEditorUser,
  TeamDocumentId,
  TeamJwt,
  TeamMemberId,
  TeamOrgId,
  TeamProjectId,
  TeamRoomAuth,
  TeamRoomIdentity,
  TeamRoomSource,
  TextFormatType,
  TrackerReferenceResolver,
} from './types';
export {
  asTeamJwt,
  asTeamMemberId,
  asTeamDocumentId,
  asTeamOrgId,
  asTeamProjectId,
} from './types';

// Advanced codec-host exports remain behind the editor entry. The docs-ui
// entry does not pull them, and mobile hosts never need to import the shell.
export {
  CollabLexicalProvider,
  HeadlessLexicalYDoc,
  MarkdownCollabContentAdapter,
} from '@nimbalyst/runtime/collab-lexical';
export type { HeadlessLexicalYDocOptions } from '@nimbalyst/runtime/collab-lexical';
