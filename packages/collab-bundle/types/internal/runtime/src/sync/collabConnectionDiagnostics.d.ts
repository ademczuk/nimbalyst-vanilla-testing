/**
 * Development-only lifecycle diagnostics for collaborative document connections.
 *
 * Enable in a running development renderer with:
 *   globalThis.__NIMBALYST_COLLAB_CONNECTION_DIAGNOSTICS__ = true
 *
 * Every call site is guarded by the build-time constant below, so production
 * builds erase both the event payload construction and this module.
 */
export interface CollabConnectionDiagnosticContext {
    cache?: 'body-doc' | 'document-replica';
    cacheKey?: string;
    documentId?: string;
    itemId?: string;
    shared?: boolean;
}
type DiagnosticLayer = 'BodyDocCache' | 'DocumentReplicaCache' | 'DocumentSyncProvider' | 'CollabLexicalProvider' | 'YDoc';
/** Build-time guard. Browser collab bundles force this off even under a dev shell. */
export declare const COLLAB_CONNECTION_DIAGNOSTICS_COMPILED: boolean;
export declare function getCollabConnectionInstanceId(owner: object, layer: DiagnosticLayer): string;
export declare function setCollabConnectionDiagnosticContext(owner: object, context: CollabConnectionDiagnosticContext): void;
export declare function emitCollabConnectionEvent(owner: object, layer: DiagnosticLayer, event: string, details?: Record<string, unknown>): void;
/**
 * Emit a Lexical-adapter event with shared-provider aggregate counts.
 * `liveBindings` follows connect/disconnect; `activeBridges` follows the Y.Doc
 * listener bridge, which intentionally survives a soft disconnect.
 */
export declare function emitCollabLexicalConnectionEvent(adapter: object, syncProvider: object, event: 'construct' | 'prepare-for-binding' | 'connect' | 'disconnect' | 'bridge-attach' | 'bridge-detach' | 'editor-doc-rotate' | 'destroy' | 'bridge-shared-to-editor' | 'bridge-editor-to-shared', details?: Record<string, unknown>): void;
export {};
