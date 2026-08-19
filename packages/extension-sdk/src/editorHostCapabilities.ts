/**
 * Reading `EditorHost.capabilities`.
 *
 * One function so the "host makes no claim" case is decided once instead of in
 * every extension. See {@link EditorHostCapabilities}.
 */

import type {
  EditorHost,
  EditorHostCapability,
} from './types/editor.js';

/**
 * Whether `host` really provides `capability`.
 *
 * A host with no `capabilities` block is treated as fully capable. That is not
 * an optimistic guess: the only such host is the Electron renderer, which
 * predates this contract and does implement every member. Any host that cannot
 * -- the browser collaborative host, and anything after it -- is required to
 * populate `capabilities`, so "absent" and "incapable" never overlap.
 *
 * ```ts
 * if (editorHostSupports(host, 'localFileSave')) {
 *   await host.saveContent(serialize());
 * }
 * ```
 */
export function editorHostSupports(
  host: Pick<EditorHost, 'capabilities'>,
  capability: EditorHostCapability,
): boolean {
  return host.capabilities ? host.capabilities.supports(capability) : true;
}

/**
 * The host's stated reason for withholding `capability`, or null when it is
 * available (or the host makes no claim). For diagnostics and degraded-mode
 * copy -- never branch on the string itself, branch on
 * {@link editorHostSupports}.
 */
export function editorHostCapabilityGap(
  host: Pick<EditorHost, 'capabilities'>,
  capability: EditorHostCapability,
): string | null {
  const gap = host.capabilities?.unavailable
    .find((entry) => entry.capability === capability);
  return gap ? gap.reason : null;
}
