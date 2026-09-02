/**
 * The browser-shaped `EditorHost`.
 *
 * The Electron renderer builds an `EditorHost` around a file on disk and a
 * workspace of services. A browser host has neither: the document IS the Y.Doc,
 * and everything a desktop host reaches for -- disk, the AI panel, Monaco,
 * document history -- either belongs to the embedding page or does not exist.
 *
 * So this host is the same contract with the missing halves declared missing
 * rather than stubbed. `browserEditorCapabilities.ts` holds the classification;
 * this module is the thing that obeys it. Two behaviours are load-bearing:
 *
 *   - Members for an unavailable capability **reject or throw**
 *     ({@link BrowserEditorCapabilityError}). A resolved `saveContent()` would
 *     tell an editor its bytes were written and let it drop its dirty state
 *     over a file that does not exist.
 *   - Optional members for an unavailable capability are **omitted**, which is
 *     how extensions already feature-detect (`if (host.fs)`).
 *
 * Collaboration is not optional here. A browser host with no `collaboration`
 * has no document at all, so the factory requires it.
 */

import type { CollaborationCommentsService } from '@nimbalyst/extension-sdk/types/comments';
import type {
  CollaborationContext,
  CollaborationStatus,
  EditorContext,
  EditorContextItem,
  EditorHost,
  EditorMenuItem,
  EditorViewport,
  RevisionSnapshotAdapter,
} from '@nimbalyst/extension-sdk/types/editor';
import type { ExtensionStorage } from '@nimbalyst/extension-sdk/types/panel';
import type { Awareness } from 'y-protocols/awareness';
import type { Doc } from 'yjs';

import {
  BrowserEditorCapabilityError,
  browserEditorCapabilityReason,
  createBrowserEditorCapabilities,
  resolveBrowserFilesystemPermission,
  type BrowserExtensionPermissions,
  type BrowserPermissionOutcome,
  type EditorHostCapabilities,
  type EditorHostCapability,
} from './browserEditorCapabilities';

/** Reported when an editor calls a member this host declared unavailable. */
export type BrowserEditorCapabilityRefusal = (
  error: BrowserEditorCapabilityError,
) => void;

export interface BrowserCollaborationContextOptions {
  yDoc: Doc;
  awareness: Awareness;
  user: { id: string; name: string; color: string };
  getStatus(): CollaborationStatus;
  onStatusChange(callback: (status: CollaborationStatus) => void): () => void;
  /**
   * Content used to seed the Y.Doc when this client is the first to open the
   * document. A browser host that opens an already-shared document has none,
   * and returns the empty string -- the server's sync response fills the doc.
   */
  loadInitialContent(): Promise<string | ArrayBuffer>;
  /** Resolve only on a server-persisted ack. See `CollaborationContext.flushWithAck`. */
  flushWithAck(timeoutMs?: number): Promise<boolean>;
  hasUndecodedContent?(): boolean;
  reportSeedOutcome?(outcome: { ok: boolean; error?: unknown }): void;
  onRevisionAdapterChange?(adapter: RevisionSnapshotAdapter | null): void;
  /**
   * Host-owned collaborative comments. Omitted -- not stubbed -- when the
   * embedding page cannot answer identity, roster and comment permission from
   * its own authenticated session, which is how extensions feature-detect the
   * capability. See `extensionComments.ts`.
   */
  comments?: CollaborationCommentsService;
}

/**
 * A `CollaborationContext` over an already-established browser session.
 *
 * Deliberately transport-agnostic: it takes the Y.Doc, the awareness instance
 * and a flush, so the same context serves a live team room and the in-memory
 * harness without either knowing about the other.
 */
export function createBrowserCollaborationContext(
  options: BrowserCollaborationContextOptions,
): CollaborationContext {
  let currentAdapter: RevisionSnapshotAdapter | null = null;
  const contentFlushes = new Set<() => void | Promise<void>>();

  const context: CollaborationContext = {
    yDoc: options.yDoc,
    awareness: options.awareness,
    user: options.user,
    getStatus: () => options.getStatus(),
    onStatusChange: (callback) => options.onStatusChange(callback),
    loadInitialContent: () => options.loadInitialContent(),
    flushWithAck: (timeoutMs) => options.flushWithAck(timeoutMs),
    hasUndecodedContent: () => options.hasUndecodedContent?.() ?? false,
    reportSeedOutcome: (outcome) => options.reportSeedOutcome?.(outcome),
    ...(options.comments ? { comments: options.comments } : {}),
    registerRevisionAdapter: (adapter) => {
      currentAdapter = adapter;
      options.onRevisionAdapterChange?.(adapter);
      return () => {
        if (currentAdapter !== adapter) return;
        currentAdapter = null;
        options.onRevisionAdapterChange?.(null);
      };
    },
    registerContentFlush: (flush) => {
      contentFlushes.add(flush);
      return () => {
        contentFlushes.delete(flush);
      };
    },
  };

  browserContentFlushes.set(context, contentFlushes);
  return context;
}

/**
 * Pending-content drains registered by bindings, keyed off the context.
 *
 * `registerContentFlush` is public on the context, but running the drain is a
 * host decision -- only the host knows when a write must be complete. Same
 * shape as the desktop host's registry, and for the same reason.
 */
const browserContentFlushes = new WeakMap<
  CollaborationContext,
  Set<() => void | Promise<void>>
>();

/**
 * Drain every binding's pending local content into the Y.Doc, then wait for
 * the server to persist it. Resolves `false` when the server did not confirm.
 *
 * A binding that debounces its local pushes holds the newest edit outside the
 * CRDT; without this, a host that reports a write as complete is reporting on
 * a value a peer update can still discard.
 */
export async function flushBrowserCollaborativeContent(
  collaboration: CollaborationContext,
): Promise<boolean> {
  for (const flush of browserContentFlushes.get(collaboration) ?? []) {
    await flush();
  }
  return collaboration.flushWithAck();
}

export interface BrowserExtensionEditorHostOptions {
  /**
   * Stable identifier for the document. There is no path on disk here, so a
   * browser host passes a synthetic URI (see `browserDocumentPath`).
   */
  filePath: string;
  fileName: string;
  collaboration: CollaborationContext;

  /** The extension's manifest permissions, when the page knows them. */
  permissions?: BrowserExtensionPermissions;

  getTheme?(): string;
  subscribeToThemeChanges?(callback: (theme: string) => void): () => void;
  isActive?(): boolean;
  isVisible?(): boolean;
  subscribeToVisibilityChanges?(callback: (visible: boolean) => void): () => void;
  isReadOnly?(): boolean;
  subscribeToReadOnlyChanges?(callback: (readOnly: boolean) => void): () => void;

  /** Text seed for `loadContent()`; defaults to the empty string. */
  getInitialContent?(): string;
  /** Bytes for `loadBinaryContent()`. Absent means the capability is absent. */
  getInitialBinaryContent?(): ArrayBuffer;

  onDirtyChange?(isDirty: boolean): void;
  onOpenHistory?(): void;
  onMenuItemsChange?(items: EditorMenuItem[]): void;
  onEditorContextChange?(context: EditorContext | null): void;
  onEditorContextItemsChange?(items: EditorContextItem[] | null): void;
  onEditorAPIChange?(api: unknown | null): void;
  openExternal?(url: string): Promise<void>;

  /**
   * Receives the editor's scroll viewport when it publishes one.
   *
   * Only a page that shows several documents in sequence supplies this -- the
   * feedback detail popover, carrying the reader's place from one design
   * alternative to the next. Absent means the `viewport` capability is absent,
   * so an extension that checks before registering gets a straight answer.
   */
  onViewportRegistered?(viewport: EditorViewport | null): void;

  /**
   * Flips the document between the extension's editor and a raw-source view.
   *
   * Supplying it is what grants the `sourceMode` capability, so a page offers
   * it only when it can honour it: somewhere to render a source editor, and a
   * codec that can project this document's Y.Doc to text and read the text
   * back. The other two members are read through this same grant -- a host
   * that can toggle but cannot report the current state would leave every
   * editor built on `useEditorLifecycle` showing a stale toggle label.
   */
  toggleSourceMode?(): void;
  isSourceModeActive?(): boolean;
  subscribeToSourceModeChanges?(callback: (active: boolean) => void): () => void;

  /**
   * Marks the editor as rendered inside another surface rather than as a full
   * page, so extensions can drop persistent chrome that makes no sense there.
   * An inline preview or a detail popover sets this; the document page does
   * not.
   */
  embedded?: boolean;

  /**
   * Called whenever the editor reaches for something this host declared
   * unavailable. The host still throws/rejects; this is the page's hook for
   * logging it, because a rejection inside an extension's effect is otherwise
   * invisible.
   */
  onCapabilityRefused?: BrowserEditorCapabilityRefusal;
}

export interface BrowserExtensionEditorHost {
  readonly host: EditorHost;
  readonly capabilities: EditorHostCapabilities;
  /** How this host answered `permissions.filesystem`. */
  readonly filesystemPermission: BrowserPermissionOutcome;
  /** The API the editor published via `registerEditorAPI`, or null. */
  getEditorAPI(): unknown | null;
  /** Menu items the editor registered, for the page to render. */
  getMenuItems(): readonly EditorMenuItem[];
  /** Push a theme change to the mounted editor. */
  notifyThemeChanged(theme: string): void;
  notifyVisibilityChanged(visible: boolean): void;
  notifyReadOnlyChanged(readOnly: boolean): void;
}

/** A stable synthetic `filePath` for a document that has no path on disk. */
export function browserDocumentPath(documentId: string, fileName: string): string {
  return `collab://${documentId}/${fileName}`;
}

export function createBrowserExtensionEditorHost(
  options: BrowserExtensionEditorHostOptions,
): BrowserExtensionEditorHost {
  const capabilities = createBrowserEditorCapabilities({
    history: Boolean(options.onOpenHistory),
    menuItems: Boolean(options.onMenuItemsChange),
    aiContext: Boolean(
      options.onEditorContextChange || options.onEditorContextItemsChange,
    ),
    binaryContent: Boolean(options.getInitialBinaryContent),
    externalLinks: Boolean(options.openExternal),
    viewport: Boolean(options.onViewportRegistered),
    sourceMode: Boolean(options.toggleSourceMode),
  });
  const filesystemPermission = resolveBrowserFilesystemPermission(options.permissions);

  const refuse = (capability: EditorHostCapability): BrowserEditorCapabilityError => {
    const error = new BrowserEditorCapabilityError(
      capability,
      browserEditorCapabilityReason(capabilities, capability),
    );
    options.onCapabilityRefused?.(error);
    return error;
  };

  const themeListeners = new Set<(theme: string) => void>();
  const visibilityListeners = new Set<(visible: boolean) => void>();
  const readOnlyListeners = new Set<(readOnly: boolean) => void>();
  let editorAPI: unknown | null = null;
  let menuItems: readonly EditorMenuItem[] = [];

  // Per-mount, in-memory. Honest for the lifetime of the editor and gone on
  // reload -- which is exactly what `persistentStorage` being unavailable
  // means. Secrets are not stored at all; a fake keychain is worse than none.
  const workspaceValues = new Map<string, unknown>();
  const globalValues = new Map<string, unknown>();
  const storage: ExtensionStorage = {
    get: <T>(key: string) => workspaceValues.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => {
      workspaceValues.set(key, value);
    },
    delete: async (key: string) => {
      workspaceValues.delete(key);
    },
    getGlobal: <T>(key: string) => globalValues.get(key) as T | undefined,
    setGlobal: async <T>(key: string, value: T) => {
      globalValues.set(key, value);
    },
    deleteGlobal: async (key: string) => {
      globalValues.delete(key);
    },
    getSecret: async () => {
      throw refuse('secretStorage');
    },
    setSecret: async () => {
      throw refuse('secretStorage');
    },
    deleteSecret: async () => {
      throw refuse('secretStorage');
    },
  };

  const host: EditorHost = {
    capabilities,

    filePath: options.filePath,
    fileName: options.fileName,
    embedded: options.embedded ?? false,
    get theme() {
      return options.getTheme?.() ?? 'auto';
    },
    get isActive() {
      return options.isActive?.() ?? true;
    },
    get visible() {
      return options.isVisible?.() ?? true;
    },
    get readOnly() {
      return options.isReadOnly?.() ?? false;
    },
    // `workspaceId` stays undefined: `workspace` is a declared gap, and an
    // invented id would be a key other hosts could collide with.

    onThemeChanged(callback) {
      themeListeners.add(callback);
      const external = options.subscribeToThemeChanges?.(callback);
      return () => {
        themeListeners.delete(callback);
        external?.();
      };
    },
    onVisibilityChanged(callback) {
      visibilityListeners.add(callback);
      const external = options.subscribeToVisibilityChanges?.(callback);
      return () => {
        visibilityListeners.delete(callback);
        external?.();
      };
    },
    onReadOnlyChanged(callback) {
      readOnlyListeners.add(callback);
      const external = options.subscribeToReadOnlyChanges?.(callback);
      return () => {
        readOnlyListeners.delete(callback);
        external?.();
      };
    },

    async loadContent() {
      return options.getInitialContent?.() ?? '';
    },
    async loadBinaryContent() {
      const bytes = options.getInitialBinaryContent?.();
      if (!bytes) throw refuse('binaryContent');
      return bytes;
    },

    onFileChanged() {
      // Not a silent stub: the capability is declared unavailable, and
      // subscribing is reported so a page can see an editor waiting for an
      // event that will never arrive. Returning a no-op unsubscribe keeps the
      // editor's cleanup path valid.
      refuse('fileChangeNotifications');
      return () => {};
    },

    setDirty(isDirty) {
      options.onDirtyChange?.(isDirty);
    },

    async saveContent() {
      // The one that must never resolve. See the module header.
      throw refuse('localFileSave');
    },

    onSaveRequested() {
      // The host never asks a collaborative document to save; persistence is
      // the server's. Reporting it tells a page that an editor is still wired
      // for the local-file lifecycle it should have branched away from.
      refuse('localFileSave');
      return () => {};
    },

    openHistory() {
      if (!options.onOpenHistory) throw refuse('history');
      options.onOpenHistory();
    },

    // `fs`, `openExternal`, the diff members, `onFindRequested` and `getConfig`
    // are omitted, not stubbed -- absence is how an extension detects them.
    // `openExternal` is added below only when the page supplied one.

    // Source mode, present only when the page granted it. All four members
    // move together: `supportsSourceMode` is what puts a "View source" control
    // on screen, and an editor that sees it must be able to act on it.
    ...(options.toggleSourceMode
      ? {
        supportsSourceMode: true,
        toggleSourceMode: () => options.toggleSourceMode?.(),
        isSourceModeActive: () => options.isSourceModeActive?.() ?? false,
        onSourceModeChanged: (callback: (active: boolean) => void) =>
          options.subscribeToSourceModeChanges?.(callback) ?? (() => {}),
      }
      : {}),

    storage,

    setEditorContext(context) {
      if (!options.onEditorContextChange) {
        refuse('aiContext');
        return;
      }
      options.onEditorContextChange(context);
    },
    setEditorContextItems(items) {
      if (!options.onEditorContextItemsChange) {
        refuse('aiContext');
        return;
      }
      options.onEditorContextItemsChange(items);
    },

    registerEditorAPI(api) {
      editorAPI = api;
      options.onEditorAPIChange?.(api);
    },

    registerViewport(viewport) {
      if (!options.onViewportRegistered) {
        refuse('viewport');
        return;
      }
      options.onViewportRegistered(viewport);
    },

    registerMenuItems(items) {
      if (!options.onMenuItemsChange) {
        refuse('menuItems');
        return;
      }
      menuItems = [...items];
      options.onMenuItemsChange(items);
    },

    collaboration: options.collaboration,
  };

  if (options.openExternal) {
    const openExternal = options.openExternal;
    host.openExternal = (url) => openExternal(url);
  }

  return {
    host,
    capabilities,
    filesystemPermission,
    getEditorAPI: () => editorAPI,
    getMenuItems: () => menuItems,
    notifyThemeChanged: (theme) => {
      for (const listener of themeListeners) listener(theme);
    },
    notifyVisibilityChanged: (visible) => {
      for (const listener of visibilityListeners) listener(visible);
    },
    notifyReadOnlyChanged: (readOnly) => {
      for (const listener of readOnlyListeners) listener(readOnly);
    },
  };
}
