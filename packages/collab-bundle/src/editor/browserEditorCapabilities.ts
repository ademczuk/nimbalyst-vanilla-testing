/**
 * What a browser host can and cannot do for an extension editor.
 *
 * This table is the source of truth for the classification, not a doc: the
 * host in `browserExtensionHost.ts` builds every one of its members from it,
 * and `EditorHost.capabilities` hands the same table to the extension so it
 * can branch before it calls.
 *
 * Two rules drove every row.
 *
 * 1. **A capability the host cannot provide must be detectable.** Where the
 *    SDK member is optional the host simply omits it, which extensions already
 *    understand. Where the member is required by `EditorHost` and cannot be
 *    omitted, the host still answers `false` here.
 * 2. **A required member that cannot work must fail, not resolve.** The one
 *    that matters is `saveContent`: resolving it would tell an editor its
 *    document had been written to a file that does not exist, and the editor
 *    would clear its dirty state on the strength of it. It rejects with
 *    {@link BrowserEditorCapabilityError} instead.
 *
 * ---
 *
 * **THIS TABLE IS AN API CONTRACT, NOT A SECURITY BOUNDARY.**
 *
 * Read that before adding anything here that sounds like a permission. An
 * extension bundle is imported into the embedding page's own realm: it shares
 * one `window`, one module graph and one origin with the console. Nothing in
 * this file can stop bundle code from calling `fetch`, reading `localStorage`,
 * or reaching the team JWT through a closure it can see. `supports()` answering
 * `false` means "the host will not do this for you"; it has never meant "you
 * cannot do this".
 *
 * That is acceptable today for exactly one reason, and it is not a property of
 * this code: the console loads a single first-party bundle, pinned at build
 * time from a workspace package, with the production build refusing dirty
 * `file:` inputs and recording source provenance. The bundle is as trusted as
 * the console itself because it *is* shipped by the console's own build.
 *
 * So: **before the browser host loads a bundle it did not build -- a
 * marketplace fetch, a user-supplied URL, a third-party publisher -- it needs a
 * real isolation boundary first** (an iframe or Worker, with the Y.Doc and this
 * host reached over `postMessage`). Widening `EditorHostCapability` or the
 * permission block below is not a substitute and will not get you one. See the
 * "Browser codec hosts" section of `docs/EXTENSION_ARCHITECTURE.md`.
 */

import type {
  EditorHostCapability,
  EditorHostCapabilities,
  EditorHostCapabilityGap,
} from '@nimbalyst/extension-sdk/types/editor';

export type { EditorHostCapability, EditorHostCapabilities, EditorHostCapabilityGap };

/** Identifies this host in `EditorHostCapabilities.environment`. */
export const BROWSER_EDITOR_ENVIRONMENT = 'browser';

/**
 * Capabilities a browser collaborative host provides for real.
 *
 * `collaboration` and `presence` head the list on purpose: this host exists to
 * run a document whose state lives in a Y.Doc, so the collaborative surface is
 * the *primary* contract here rather than the optional extra it is on desktop.
 */
export const BROWSER_EDITOR_SUPPORTED_CAPABILITIES = [
  'collaboration',
  'presence',
  'dirtyState',
  'theme',
  'readOnly',
  'visibility',
  'initialContent',
  'editorApi',
] as const satisfies readonly EditorHostCapability[];

/**
 * Capabilities a browser collaborative host cannot provide, each with the
 * reason an extension author would need to understand the gap.
 *
 * `history`, `menuItems`, `aiContext`, `binaryContent` and `sourceMode` are
 * absent from BOTH lists: they are conditional on what the embedding page wired
 * up, so {@link createBrowserEditorCapabilities} resolves them per mount.
 */
export const BROWSER_EDITOR_CAPABILITY_GAPS = [
  {
    capability: 'localFileSave',
    reason:
      'A browser host has no local file to write. Collaborative documents are '
      + 'persisted by the server from the Y.Doc; saveContent() rejects rather '
      + 'than resolving on a write that never happened.',
  },
  {
    capability: 'fileChangeNotifications',
    reason:
      'Nothing watches a file here. Out-of-band changes arrive as Y.Doc '
      + 'updates from other clients, not as onFileChanged callbacks.',
  },
  {
    capability: 'projectFileSystem',
    reason:
      'There is no workspace on disk to read or compare-and-swap, so host.fs '
      + 'is omitted entirely.',
  },
  {
    capability: 'workspace',
    reason: 'A browser host opens one shared document, not a workspace.',
  },
  {
    capability: 'diffMode',
    reason:
      'AI edit review is a desktop flow driven by on-disk history; the diff '
      + 'members are omitted.',
  },
  {
    capability: 'findCommand',
    reason:
      'Find arrives on desktop as a native menu accelerator over IPC. A '
      + 'browser page has no equivalent to route, so onFindRequested is omitted.',
  },
  {
    capability: 'persistentStorage',
    reason:
      'host.storage is per-mount and in-memory. It is a real store for the '
      + 'lifetime of the editor and empty again after a reload; the bundle '
      + 'never reaches for browser storage on the host page\'s behalf.',
  },
  {
    capability: 'secretStorage',
    reason:
      'There is no secret store to reach. getSecret/setSecret reject rather '
      + 'than pretending to hold a credential.',
  },
  {
    capability: 'configuration',
    reason:
      'Extension configuration lives in host settings this bundle does not '
      + 'load; getConfig is omitted.',
  },
] as const satisfies readonly EditorHostCapabilityGap[];

/**
 * Thrown by a host member that the host has already declared unavailable.
 *
 * Carries the capability id so a caller can map back to
 * `EditorHostCapabilities.unavailable` and to
 * `editorHostSupports(host, capability)` -- the check that would have avoided
 * the call.
 */
export class BrowserEditorCapabilityError extends Error {
  readonly capability: EditorHostCapability;

  constructor(capability: EditorHostCapability, reason: string) {
    super(`The browser editor host cannot provide "${capability}". ${reason}`);
    this.name = 'BrowserEditorCapabilityError';
    this.capability = capability;
  }
}

/**
 * Capabilities the embedding page can grant by supplying the matching hook.
 * Absent hook, absent capability -- there is no partial version of these.
 */
export interface BrowserEditorGrantedCapabilities {
  /** `openHistory()` reaches a real history surface. */
  history?: boolean;
  /** `registerMenuItems()` reaches a real actions menu. */
  menuItems?: boolean;
  /** `setEditorContext` / `setEditorContextItems` reach an AI surface. */
  aiContext?: boolean;
  /** `loadBinaryContent()` has real bytes to return. */
  binaryContent?: boolean;
  /** `openExternal()` is wired to the page's navigation policy. */
  externalLinks?: boolean;
  /** `registerViewport()` reaches a surface that carries scroll between docs. */
  viewport?: boolean;
  /**
   * `toggleSourceMode()` reaches a real raw-source view for this document.
   *
   * This used to be a static gap whose reason read "source mode renders Monaco,
   * which this bundle deliberately does not ship". That was a description of
   * one build, never a product position, and it is no longer true: the console
   * ships Monaco behind a lazy import. Whether a source view exists was always
   * a property of the embedding page rather than of browsers, which is why it
   * belongs here next to `history` and `menuItems` rather than in the fixed
   * list.
   *
   * A page grants it per mount, and only when it can honour it end to end: it
   * needs somewhere to render Monaco AND a codec that can project this
   * document's Y.Doc to text and read the text back. A structured Y.Doc has no
   * text in it, so without the codec there is nothing honest to show.
   */
  sourceMode?: boolean;
}

const CONDITIONAL_GAP_REASONS: Record<
  keyof BrowserEditorGrantedCapabilities,
  string
> = {
  history: 'The embedding page did not supply a history surface for this document.',
  menuItems: 'The embedding page did not supply an actions menu to register into.',
  aiContext: 'The embedding page did not supply an AI surface to push selection context to.',
  binaryContent:
    'This document was opened without binary seed content, so there are no '
    + 'bytes to return. Read the document through host.collaboration.yDoc.',
  externalLinks:
    'The embedding page did not supply a URL opener, so the bundle will not '
    + 'navigate on its behalf.',
  viewport:
    'This page shows one document at a time, so there is nothing to carry a '
    + 'scroll position to. Only a surface that steps between documents -- the '
    + 'feedback detail popover -- listens for one.',
  sourceMode:
    'This page did not offer a raw-source view for this document. Source mode '
    + 'needs an editor that declares it and a codec that can project the Y.Doc '
    + 'to text and read the text back; without both there is nothing to show.',
};

/**
 * Build the capability answer for one mount.
 *
 * The static gap list is fixed; the conditional ones are resolved from what
 * the embedding page actually wired up, so `supports()` never claims something
 * the page left unimplemented.
 */
export function createBrowserEditorCapabilities(
  granted: BrowserEditorGrantedCapabilities = {},
): EditorHostCapabilities {
  const conditionalGaps = (
    Object.keys(CONDITIONAL_GAP_REASONS) as (keyof BrowserEditorGrantedCapabilities)[]
  )
    .filter((capability) => !granted[capability])
    .map((capability): EditorHostCapabilityGap => ({
      capability,
      reason: CONDITIONAL_GAP_REASONS[capability],
    }));

  const unavailable: EditorHostCapabilityGap[] = [
    ...BROWSER_EDITOR_CAPABILITY_GAPS,
    ...conditionalGaps,
  ];
  const unavailableSet = new Set(unavailable.map((gap) => gap.capability));

  return {
    environment: BROWSER_EDITOR_ENVIRONMENT,
    unavailable,
    supports: (capability) => !unavailableSet.has(capability),
  };
}

/** Look up why a capability is unavailable, for error messages. */
export function browserEditorCapabilityReason(
  capabilities: EditorHostCapabilities,
  capability: EditorHostCapability,
): string {
  return capabilities.unavailable
    .find((gap) => gap.capability === capability)?.reason
    ?? 'This host does not provide that capability.';
}

// ---------------------------------------------------------------------------
// Manifest permissions
// ---------------------------------------------------------------------------

/**
 * The manifest permission block, narrowed to what a browser host actually
 * answers -- which is one field.
 *
 * The manifest also carries `ai` and `network`. They are deliberately absent
 * here rather than declared-and-ignored: this host consults neither, and a
 * browser host could not enforce either one if it wanted to, because extension
 * code shares the page's realm and reaches `fetch` directly (see the module
 * header). Declaring them would read as a gate that does not exist.
 *
 * If a future host can genuinely mediate one of them -- an iframe-isolated
 * bundle whose network egress goes through the parent -- add the field back
 * together with the code that enforces it, not before.
 */
export interface BrowserExtensionPermissions {
  filesystem?: boolean;
}

export interface BrowserPermissionOutcome {
  /** What the extension's manifest asked for. */
  declared: boolean;
  /** Whether this host granted it. */
  granted: boolean;
  /** Why, when it was refused. */
  reason?: string;
}

/**
 * How a browser host answers `permissions: { filesystem: true }`.
 *
 * **Declared-but-ungranted.** The manifest field stays valid and loading is
 * never refused over it; the host simply grants no filesystem capability
 * (`host.fs` absent, `saveContent` rejecting, `projectFileSystem` and
 * `localFileSave` in the gap list).
 *
 * The alternative -- refusing to load an extension that declares it -- was
 * rejected because the permission is declared for the extension's *services*
 * (`context.services.filesystem`, AI tools reading workspace files), not for
 * its editor contribution, and every editor extension that ships today
 * declares it. Refusing on the declaration alone would exclude all of them
 * from the browser to protect against a call the collaborative editor path
 * does not make. Making it a hard error is also the wrong shape for a manifest
 * that is written once and consumed by two hosts with different powers: the
 * grant belongs to the host, the declaration to the extension.
 *
 * What must NOT happen is a quiet grant. The gap is recorded, `supports()`
 * answers false, and the members reject -- so an extension that does reach for
 * disk finds out immediately instead of writing into a void.
 *
 * "Granted" here describes what this host offers, not what the bundle is
 * confined to. There is no disk in a browser tab, so `granted: false` costs an
 * attacker nothing and denies a well-behaved extension a real service; it is
 * the honest answer to a manifest question, not an enforced sandbox. The
 * module header says why that distinction matters.
 */
export function resolveBrowserFilesystemPermission(
  permissions: BrowserExtensionPermissions | undefined,
): BrowserPermissionOutcome {
  const declared = permissions?.filesystem === true;
  return {
    declared,
    granted: false,
    reason:
      'A browser host has no filesystem to grant. The extension loads and its '
      + 'collaborative editor runs; filesystem-backed host members are absent '
      + 'or reject.',
  };
}
