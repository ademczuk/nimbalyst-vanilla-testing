/**
 * True when `documentId` is already a plain URL-safe token (UUID or sha256
 * hex). Used only to emit a one-time diagnostic for legacy filename-shaped ids
 * -- it never blocks; the id is encoded either way.
 */
export declare function isValidCollabDocumentId(documentId: unknown): documentId is string;
/**
 * Build the room id for a document room with the documentId segment URL-encoded
 * so the result is always a valid URL path component. The collab server decodes
 * it back before addressing the DocumentRoom DO.
 */
export declare function encodeDocumentRoomId(orgId: string, documentId: string): string;
