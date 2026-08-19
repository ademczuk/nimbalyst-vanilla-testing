/**
 * Reading a local file as the seed for a collaborative document.
 *
 * Extracted from `CommonFileActions` so a headless publisher can share a file
 * without pulling the context-menu component (and its dialogs) into its module
 * graph. The binary branch matters: an `opaque-versioned` type is seeded from
 * bytes, and handing it a UTF-8 string corrupts the document on first share.
 */

import type { CollaborativeDocumentTypeDescriptor } from './CollaborativeDocumentTypeCatalog';

function decodeBase64Bytes(base64: string): Uint8Array {
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export async function readShareToTeamSourceContent(
  filePath: string,
  descriptor: CollaborativeDocumentTypeDescriptor,
): Promise<string | Uint8Array> {
  const binary = descriptor.content.strategy === 'opaque-versioned';
  const api = window.electronAPI;
  const result = api?.readFileContent
    ? await api.readFileContent(filePath, binary ? { binary: true } : undefined)
    : await api?.invoke?.('read-file-content', filePath, binary ? { binary: true } : undefined);
  if (!result?.success || typeof result.content !== 'string') {
    const reason = result && 'error' in result ? result.error : 'The source file could not be read.';
    throw new Error(reason);
  }
  return binary ? decodeBase64Bytes(result.content) : result.content;
}
