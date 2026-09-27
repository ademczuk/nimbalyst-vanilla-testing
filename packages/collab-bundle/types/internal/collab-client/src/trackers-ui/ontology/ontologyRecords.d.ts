/**
 * The slice of a tracker record the ontology analysis reads, and the helpers
 * that read it the same way every host stores it.
 *
 * Structural, so desktop records, the browser store's `TrackerRecord` and a
 * test fixture all satisfy it without conversion.
 */
export interface OntologyRecordLike {
    id: string;
    primaryType: string;
    issueKey?: string;
    archived?: boolean;
    fields: Record<string, unknown>;
    system?: {
        createdAt?: string;
        updatedAt?: string;
    };
}
/**
 * A field's value wherever the room put it: the wire format flattens custom
 * fields onto `fields`, but an item written through `data.customFields` can
 * still carry them there.
 */
export declare function ontologyFieldValue(record: OntologyRecordLike, name: string): unknown;
export declare function ontologyRecordTitle(record: OntologyRecordLike): string;
export declare function isEmptyFieldValue(value: unknown): boolean;
/** Item ids a relationship (or citation) value names: a string, `{ itemId }`, or a list of either. */
export declare function refTargets(value: unknown): string[];
export declare function recordRefs(record: OntologyRecordLike, field: string): string[];
export declare function stringList(value: unknown): string[];
export declare function byTitle(a: OntologyRecordLike, b: OntologyRecordLike): number;
