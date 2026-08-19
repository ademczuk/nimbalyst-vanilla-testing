import type { CollabEditorTermination } from './types';

export type ObservedDocumentServerSignal =
  | {
      type: 'write-acknowledged';
      clientUpdateId: string;
    }
  | {
      type: 'read-only';
      message: string;
      clientUpdateId?: string;
    }
  | {
      type: 'access-revoked';
      message: string;
      clientUpdateId?: string;
    };

/** Inspect only authorization/durability signals; DocumentSync owns all decoding. */
export function parseDocumentServerSignal(data: unknown): ObservedDocumentServerSignal | null {
  if (typeof data !== 'string') return null;
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  if (!message || typeof message !== 'object') return null;
  const record = message as Record<string, unknown>;
  if (record.type === 'docUpdateAck' && typeof record.clientUpdateId === 'string') {
    return { type: 'write-acknowledged', clientUpdateId: record.clientUpdateId };
  }
  if (record.type !== 'error' || typeof record.code !== 'string') return null;
  const details = {
    message: typeof record.message === 'string' ? record.message : record.code,
    ...(typeof record.clientUpdateId === 'string'
      ? { clientUpdateId: record.clientUpdateId }
      : {}),
  };
  if (record.code === 'document_read_only') return { type: 'read-only', ...details };
  if (record.code === 'document_access_revoked') return { type: 'access-revoked', ...details };
  return null;
}

export function classifyDocumentClose(
  code: number,
  reason: string,
): CollabEditorTermination | null {
  if (code === 4002) {
    return { reason: 'removed-from-org', closeCode: 4002, message: reason || 'Removed from team' };
  }
  if (code === 4003) {
    return {
      reason: 'document-access-revoked',
      closeCode: 4003,
      message: reason || 'Document access revoked',
    };
  }
  // A deleted document is terminal in the same way access removal is: the room
  // is gone, so reconnecting can only fail again. Hosts need it distinguished
  // from a revocation because it is not an access problem to explain away.
  if (code === 4004) {
    return { reason: 'deleted-document', closeCode: 4004, message: reason || 'Document was deleted' };
  }
  return null;
}
