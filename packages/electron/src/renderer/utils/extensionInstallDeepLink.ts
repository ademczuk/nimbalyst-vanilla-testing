/**
 * `nimbalyst://install/<extensionId>` parsing for in-app clicks.
 *
 * The OS-level protocol handler already routes this scheme when the link
 * arrives from outside the app. This is the in-renderer half: /planning:nimbalyst-coach
 * renders install links in the transcript, and a click on one has to resolve to
 * an extension id before it can open the marketplace.
 *
 * Extracted from the App click handler so the parsing is testable on its own --
 * in particular the malformed-escape case, which throws rather than returning
 * a bad value and would otherwise surface as an uncaught error inside a
 * document-level click listener.
 */

export const EXTENSION_INSTALL_LINK_PREFIX = 'nimbalyst://install/';

/**
 * Extract the extension id from an install deep link.
 *
 * Returns null for anything that is not a well-formed install link with a
 * non-empty id, so the caller can fall through to normal link handling instead
 * of opening the marketplace on nothing.
 */
export function parseExtensionInstallLink(href: string | null | undefined): string | null {
  if (!href || !href.startsWith(EXTENSION_INSTALL_LINK_PREFIX)) return null;

  const raw = href.slice(EXTENSION_INSTALL_LINK_PREFIX.length).trim();
  if (raw.length === 0) return null;

  // Ignore any query/fragment an author appended; the id is the path segment.
  const idPart = raw.split(/[?#]/)[0];
  if (idPart.length === 0) return null;

  try {
    const decoded = decodeURIComponent(idPart);
    return decoded.length > 0 ? decoded : null;
  } catch {
    // Malformed percent-escape (e.g. `%ZZ`). decodeURIComponent throws a
    // URIError; a click handler is the wrong place to discover that.
    return null;
  }
}
