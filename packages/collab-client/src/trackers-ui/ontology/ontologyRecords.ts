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
  system?: { createdAt?: string; updatedAt?: string };
}

/**
 * A field's value wherever the room put it: the wire format flattens custom
 * fields onto `fields`, but an item written through `data.customFields` can
 * still carry them there.
 */
export function ontologyFieldValue(record: OntologyRecordLike, name: string): unknown {
  const direct = record.fields[name];
  if (direct !== undefined && direct !== null) return direct;
  const custom = record.fields.customFields;
  return custom && typeof custom === 'object' ? (custom as Record<string, unknown>)[name] : undefined;
}

export function ontologyRecordTitle(record: OntologyRecordLike): string {
  const title = record.fields.title;
  return (typeof title === 'string' && title.trim()) || record.issueKey || record.id;
}

export function isEmptyFieldValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** Item ids a relationship (or citation) value names: a string, `{ itemId }`, or a list of either. */
export function refTargets(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refTargets);
  if (typeof value === 'string' && value) return [value];
  if (value && typeof value === 'object' && typeof (value as { itemId?: unknown }).itemId === 'string') {
    return [(value as { itemId: string }).itemId];
  }
  return [];
}

export function recordRefs(record: OntologyRecordLike, field: string): string[] {
  return refTargets(ontologyFieldValue(record, field));
}

export function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

export function byTitle(a: OntologyRecordLike, b: OntologyRecordLike): number {
  return ontologyRecordTitle(a).localeCompare(ontologyRecordTitle(b));
}
