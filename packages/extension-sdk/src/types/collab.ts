/**
 * CollabCodec
 *
 * Per-extension Y.Doc content contract: the single, PURE thing an editor
 * defines for collaboration. Pure functions `file bytes <-> Y.Doc shape` (no
 * React, no host imports) so the same code seeds a live editor AND runs
 * headlessly (Share-to-Team without the editor open, re-upload from local
 * origin, plain-text projection for search/AI). It lets host features
 * (re-upload, history, export, AI editing, search indexing, comments, backup,
 * restore) operate on any extension's collaborative document without knowing
 * its internal layout.
 *
 * Extensions register a codec via
 * `context.services.collab.registerContentAdapter(...)` from their
 * `activate()` function, and pass the SAME codec to
 * `useCollaborativeEditor(host, { codec, bind })`. `isEmpty` / `seedFromFile`
 * / `exportToFile` are therefore defined exactly ONCE, on the codec -- the
 * live seed and the headless seed are provably the same code.
 *
 * Codecs run only client-side (main process, renderer, extensions). The collab
 * Worker stays codec-agnostic and treats Y.Doc state as opaque ciphertext. The
 * renderer registry is authoritative; the main-process registry is an optional
 * cache (in-repo statics + text descriptors) and its absence degrades to
 * client seeding, never a hard error.
 *
 * NOTE: This is the canonical definition. The host-internal
 * `@nimbalyst/collab-adapters` registry re-imports this type --
 * do not fork the interface there.
 *
 * @see CollabContentAdapter -- the former name, kept as a deprecated alias.
 */
import type { Doc } from 'yjs';
import type { CommentAnchor } from './comments';

export type CollabContentFileSource = string | Uint8Array;

/**
 * Serializable description of a CollabContentAdapter that lets the HOST
 * replicate the adapter in another process (e.g. the Electron main process)
 * WITHOUT loading the extension's code or doing a dynamic import. Only adapters
 * built from a known host factory carry one. Today the single kind is `text`
 * (a one-`Y.Text` document, produced by `createTextCollabContentAdapter`).
 */
export interface TextCollabAdapterDescriptor {
  kind: 'text';
  documentType: string;
  fileExtensions: string[];
  mimeType?: string;
  textField: string;
  layoutVersion: number;
}

export type CollabAdapterDescriptor = TextCollabAdapterDescriptor;

export interface CollabCodecMigration {
  from: number;
  to: number;
  run(yDoc: Doc): void;
}

/**
 * Structured-comment anchor support for headless hosts. Hosts invoke these
 * reads against a detached, disposable Y.Doc snapshot rather than the live
 * collaborative document, so an accidental mutation cannot alter or sync the
 * real document. Codecs should still treat the snapshot as read-only.
 */
export interface CollabCommentAnchorCodec {
  handles(anchor: CommentAnchor): boolean;
  getState(snapshot: Doc, anchor: CommentAnchor): 'attached' | 'orphaned';
  describe(snapshot: Doc, anchor: CommentAnchor): string;
}

/** @deprecated Renamed to {@link CollabCodecMigration}. */
export type CollabContentAdapterMigration = CollabCodecMigration;

export interface CollabCodec<TStructured = unknown> {
  /** Identifies this codec; matches the shared doc's documentType. */
  documentType: string;

  /** File extensions this adapter is the on-disk codec for. Include
   *  the leading dot (e.g. '.md', '.mockup.html'). The first entry is
   *  used as the default by save-a-copy / export-to-file flows. */
  fileExtensions: string[];

  /** Optional MIME type used by save dialogs and asset uploads. */
  mimeType?: string;

  /** Layout schema version. Bump when the Y.Doc shape changes; pair
   *  with `migrations` to migrate older docs forward before any
   *  write op. */
  layoutVersion: number;

  /** Optional migrations from older layout versions. Run by the
   *  registry before `applyFromFile` / `applyStructuredPatch` when
   *  the Y.Doc's recorded layoutVersion is older than this adapter's
   *  layoutVersion. */
  migrations?: CollabCodecMigration[];

  /** True iff the Y.Doc has no extension content yet. Used to gate
   *  the initial-share seed flow. Shared by the live seed (the hook)
   *  and every headless seed path, so they can never disagree. */
  isEmpty(yDoc: Doc): boolean;

  /** Seed an empty Y.Doc from on-disk file bytes/text. Initial share
   *  only -- adapters can assume `isEmpty(yDoc) === true`. */
  seedFromFile(yDoc: Doc, source: CollabContentFileSource): void;

  /** Replace Y.Doc content with the supplied on-disk file content.
   *  Must be safe to call on a populated Y.Doc. Default behaviour is
   *  wipe-and-reseed inside a single Y.Doc transaction. Adapters
   *  that want finer-grained history can override with a
   *  diff-and-patch implementation. */
  applyFromFile(yDoc: Doc, source: CollabContentFileSource): void;

  /** Serialize the live Y.Doc back to the on-disk file format. */
  exportToFile(yDoc: Doc): string | Uint8Array;

  /** Plain-text projection for search, AI prompts, diffs, history
   *  previews. Lossy is fine; this is not a round-trip channel. */
  toPlainText(yDoc: Doc): string;

  /** Optional: structured projection for AI tool-call edits and
   *  comment anchoring. Shape is extension-defined. Paired with
   *  `applyStructuredPatch`. */
  toStructured?(yDoc: Doc): TStructured;

  /** Optional: write structured edits back. Paired with
   *  `toStructured`. The PREFERRED AI-write surface: implementing
   *  both lets an agent edit this document type structurally.
   *
   *  It is NOT a gate. When an adapter does not implement the pair,
   *  an agent edit falls back to `exportToFile` -> text replacement
   *  -> `applyFromFile`, so every adapter is AI-writable whether or
   *  not it opted in. Two consequences an adapter author must know:
   *
   *   - `applyFromFile` is called with agent-authored content, not
   *     just on-disk content, so it must be safe to call on a
   *     populated Y.Doc (it already must be) AND must be able to
   *     consume its own `exportToFile` output unchanged. That
   *     round-trip is asserted for every registered adapter in
   *     `codecOnlyHeadlessEdit.test.ts`.
   *   - The fallback rewrites the whole document, so a concurrent
   *     human edit can interleave. Implement the structured pair to
   *     get minimal deltas instead. */
  applyStructuredPatch?(yDoc: Doc, patch: unknown): void;

  /** Optional snapshot-isolated resolver for structured comment anchors. */
  commentAnchors?: CollabCommentAnchorCodec;

  /** Optional: produce a snapshot for revision history. Defaults to
   *  `Y.encodeStateAsUpdateV2(yDoc)`. Override if you need a denser
   *  snapshot format. */
  exportRevisionSnapshot?(yDoc: Doc): Uint8Array;

  /** Optional: restore a revision snapshot. Defaults to
   *  `Y.applyUpdateV2(yDoc, bytes)`. */
  restoreRevisionSnapshot?(yDoc: Doc, bytes: Uint8Array): void;

  /** Optional: a serializable descriptor the host can ship to another process
   *  to rebuild this adapter without the extension's code. Set automatically by
   *  host factories like `createTextCollabContentAdapter`; hand-written
   *  adapters may leave it undefined (they stay process-local). */
  serializableDescriptor?: CollabAdapterDescriptor;
}

/**
 * @deprecated Renamed to {@link CollabCodec}. Same shape -- a codec is a pure
 * `file bytes <-> Y.Doc shape` contract. Kept so existing extensions and the
 * host-internal `@nimbalyst/collab-adapters` registry keep compiling.
 */
export type CollabContentAdapter<TStructured = unknown> =
  CollabCodec<TStructured>;

/**
 * The collab surface on the extension context. Extensions call into
 * this from their `activate()` to register a collab codec for any
 * document type they ship.
 */
export interface ExtensionCollabService {
  /**
   * Register a CollabCodec for one of the extension's document types.
   * Returns a Disposable that unregisters on deactivation; the host also
   * tracks the registration in `context.subscriptions` automatically.
   *
   * (Named `registerContentAdapter` for backwards compatibility; it accepts a
   * {@link CollabCodec}.)
   */
  registerContentAdapter(codec: CollabCodec): { dispose(): void };
}
