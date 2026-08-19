/**
 * The published `types/editor.d.ts` is hand-authored, so nothing but a
 * compile-time assertion stops it drifting from the implementation it
 * describes. Each pair below is bidirectional on purpose: one direction alone
 * would let the declaration quietly widen (or narrow) a signature.
 *
 * The `EditorHost` contract itself is NOT restated in the declaration -- it is
 * the SDK's own, inlined by `scripts/build-types.mjs` -- and the assertion at
 * the bottom proves the published type really is that type, not a copy that
 * happens to look like it today.
 */

import type { ComponentType } from 'react';

import {
  browserDocumentPath as publicBrowserDocumentPath,
  createBrowserCollaborationContext as publicCreateBrowserCollaborationContext,
  createBrowserEditorCapabilities as publicCreateBrowserEditorCapabilities,
  createBrowserExtensionEditorHost as publicCreateBrowserExtensionEditorHost,
  flushBrowserCollaborativeContent as publicFlushBrowserCollaborativeContent,
  resolveBrowserFilesystemPermission as publicResolveBrowserFilesystemPermission,
  type EditorHost as PublicEditorHost,
  type ExtensionEditorComponent as PublicExtensionEditorComponent,
  type ExtensionEditorHandle as PublicExtensionEditorHandle,
  type ExtensionEditorMountOptions as PublicExtensionEditorMountOptions,
} from '@nimbalyst/collab-bundle/editor';
import type { EditorHost as SdkEditorHost } from '@nimbalyst/extension-sdk/types/editor';

import {
  browserDocumentPath,
  createBrowserCollaborationContext,
  createBrowserEditorCapabilities,
  createBrowserExtensionEditorHost,
  flushBrowserCollaborativeContent,
  resolveBrowserFilesystemPermission,
} from '../editor/index';
import type {
  ExtensionEditorHandle,
  ExtensionEditorMountOptions,
} from '../editor/mountExtensionEditor';

// `mountExtensionEditor`'s signature carries the nominal team-id brands, which
// are declared independently on each side and therefore never cross-assignable
// (the same reason `public-jwt-brand-typecheck.ts` asserts them separately).
// Member-name parity is what actually drifts here: an option added to the
// implementation and forgotten in the declaration, or vice versa.
declare const publicMountKeys: keyof PublicExtensionEditorMountOptions;
declare const sourceMountKeys: keyof ExtensionEditorMountOptions;
declare const publicHandleKeys: keyof PublicExtensionEditorHandle;
declare const sourceHandleKeys: keyof ExtensionEditorHandle;
const mountKeysForward: keyof PublicExtensionEditorMountOptions = sourceMountKeys;
const mountKeysBack: keyof ExtensionEditorMountOptions = publicMountKeys;
const handleKeysForward: keyof PublicExtensionEditorHandle = sourceHandleKeys;
const handleKeysBack: keyof ExtensionEditorHandle = publicHandleKeys;

const hostForward: typeof publicCreateBrowserExtensionEditorHost =
  createBrowserExtensionEditorHost;
const hostBack: typeof createBrowserExtensionEditorHost =
  publicCreateBrowserExtensionEditorHost;

const collabForward: typeof publicCreateBrowserCollaborationContext =
  createBrowserCollaborationContext;
const collabBack: typeof createBrowserCollaborationContext =
  publicCreateBrowserCollaborationContext;

const capabilitiesForward: typeof publicCreateBrowserEditorCapabilities =
  createBrowserEditorCapabilities;
const capabilitiesBack: typeof createBrowserEditorCapabilities =
  publicCreateBrowserEditorCapabilities;

const permissionForward: typeof publicResolveBrowserFilesystemPermission =
  resolveBrowserFilesystemPermission;
const permissionBack: typeof resolveBrowserFilesystemPermission =
  publicResolveBrowserFilesystemPermission;

const flushForward: typeof publicFlushBrowserCollaborativeContent =
  flushBrowserCollaborativeContent;
const flushBack: typeof flushBrowserCollaborativeContent =
  publicFlushBrowserCollaborativeContent;

const pathForward: typeof publicBrowserDocumentPath = browserDocumentPath;
const pathBack: typeof browserDocumentPath = publicBrowserDocumentPath;

// The published host IS the SDK host. If the declaration ever became a
// look-alike copy, one of these two assignments would stop compiling the first
// time the SDK changed.
declare const sdkHost: SdkEditorHost;
declare const publicHost: PublicEditorHost;
const publishedHostAcceptsSdkHost: PublicEditorHost = sdkHost;
const sdkHostAcceptsPublishedHost: SdkEditorHost = publicHost;

// An extension component typed against the SDK must mount without a cast --
// this is the whole point of the entry point.
declare const sdkComponent: ComponentType<{ host: SdkEditorHost }>;
const mountableComponent: PublicExtensionEditorComponent = sdkComponent;

void mountKeysForward;
void mountKeysBack;
void handleKeysForward;
void handleKeysBack;
void hostForward;
void hostBack;
void collabForward;
void collabBack;
void capabilitiesForward;
void capabilitiesBack;
void permissionForward;
void permissionBack;
void flushForward;
void flushBack;
void pathForward;
void pathBack;
void publishedHostAcceptsSdkHost;
void sdkHostAcceptsPublishedHost;
void mountableComponent;
