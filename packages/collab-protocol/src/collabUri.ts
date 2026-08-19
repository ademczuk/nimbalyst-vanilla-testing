/**
 * Collaborative document URI utilities
 *
 * URI format: collab://org:{orgId}:doc:{documentId}
 *
 * These URIs identify collaborative documents backed by DocumentRoom
 * Durable Objects. They are used as tab identifiers in the tab system,
 * similar to how virtual:// URIs are used for non-filesystem tabs.
 */

import type { TeamDocumentRoomId } from './roomIds.js';

const COLLAB_PREFIX = 'collab://';

/**
 * Check if a path is a collaborative document URI.
 */
export function isCollabUri(path: string): boolean {
  return path.startsWith(COLLAB_PREFIX);
}

/**
 * Parse a collab:// URI into its component parts.
 * Throws if the URI doesn't match the expected format.
 *
 * @example
 * parseCollabUri('collab://org:abc123:doc:xyz789')
 * // => { orgId: 'abc123', documentId: 'xyz789' }
 */
export function parseCollabUri(uri: string): { orgId: string; documentId: string } {
  if (!isCollabUri(uri)) {
    throw new Error(`Not a collab URI: ${uri}`);
  }

  const path = uri.slice(COLLAB_PREFIX.length);
  // Expected format: org:{orgId}:doc:{documentId}
  const match = /^org:([^:]+):doc:(.+)$/.exec(path);
  const orgId = match?.[1];
  const documentId = match?.[2];
  if (orgId === undefined || documentId === undefined) {
    throw new Error(`Invalid collab URI format: ${uri}`);
  }

  return {
    orgId,
    documentId,
  };
}

/**
 * Build a collab:// URI from org and document IDs.
 *
 * @example
 * buildCollabUri('abc123', 'xyz789')
 * // => 'collab://org:abc123:doc:xyz789'
 */
export function buildCollabUri(orgId: string, documentId: string): string {
  return `${COLLAB_PREFIX}org:${orgId}:doc:${documentId}`;
}

/**
 * Build the DocumentRoom ID from a collab URI.
 * This matches the room ID format used by the collabv3 server routing.
 */
export function collabUriToRoomId(uri: string): TeamDocumentRoomId {
  const { orgId, documentId } = parseCollabUri(uri);
  return `org:${orgId}:doc:${documentId}`;
}
