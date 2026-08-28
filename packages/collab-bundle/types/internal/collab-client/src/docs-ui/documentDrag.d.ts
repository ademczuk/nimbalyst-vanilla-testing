/**
 * The drag payload a shared document carries out of the docs tree.
 *
 * The tree's own drag already puts the document id on `text/plain`, and that is
 * enough for the tree itself: a folder drop knows which org it is in because it
 * is the same tree. It is not enough for anyone else. A bare id names nothing
 * addressable -- `nimbalyst://doc/<orgId>/<documentId>` needs the org -- and a
 * card built from one would be titled with a UUID.
 *
 * So the org and the human title ride along under their own MIME type. Kept
 * here rather than in the sidebar so the reader and the writer cannot drift:
 * a drop target that guesses at this shape gets a card pointing at nothing.
 */
export declare const COLLAB_DOCUMENT_DRAG_TYPE = "application/x-nimbalyst-collab-document";
export interface CollabDocumentDragPayload {
    orgId: string;
    documentId: string;
    title: string;
}
/**
 * Parse a payload written by the docs tree, or null.
 *
 * Defensive because a `DataTransfer` is an open channel: any page, any
 * extension, and any future version of this app can put a string under this
 * type, and the caller turns the result into a persisted document reference.
 */
export declare function parseCollabDocumentDrag(raw: string | null | undefined): CollabDocumentDragPayload | null;
