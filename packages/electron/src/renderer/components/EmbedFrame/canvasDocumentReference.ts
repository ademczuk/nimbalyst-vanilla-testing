/**
 * A canvas `doc` card's URI, as an org + document pair.
 *
 * Two spellings reach here and both are real. `collab://` is what the app
 * writes today and what `openCollabDocument` registers a tab under;
 * `nimbalyst://doc/<orgId>/<documentId>` is the form the canvas format spec
 * names, so a board authored by hand or by another tool uses it. Accepting both
 * is cheaper than a migration and costs one branch.
 *
 * Extracted from `CanvasCardHost` so the card renderer and the in-document
 * comment counts resolve a reference the same way. Two parsers that disagree
 * would show a badge on one card and mount another.
 */

import { isCollabUri, parseCollabUri } from '@nimbalyst/collab-protocol';

export interface CanvasDocumentReference {
  orgId: string;
  documentId: string;
}

export function parseCanvasDocumentReference(
  uri: string,
): CanvasDocumentReference | null {
  if (isCollabUri(uri)) {
    try {
      return parseCollabUri(uri);
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(uri);
    if (url.protocol !== 'nimbalyst:' || url.hostname !== 'doc') return null;
    const [encodedOrgId, ...documentParts] = url.pathname
      .replace(/^\/+/, '')
      .split('/');
    if (!encodedOrgId || documentParts.length === 0) return null;
    return {
      orgId: decodeURIComponent(encodedOrgId),
      documentId: decodeURIComponent(documentParts.join('/')),
    };
  } catch {
    return null;
  }
}
