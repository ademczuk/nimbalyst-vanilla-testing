/**
 * One category's detail page: the members table and the "Schema: how this is
 * stored" disclosure. Split from `ontologyDomain.ts`, which decides what the
 * categories and their relationship lines are; this only lays them out.
 */
import type { DomainContext, DomainSchema, LineCalc, MemberTable } from './ontologyDomain';
import { type OntologyRecordLike } from './ontologyRecords';
/** A fact's as-of date to its precision: "Mar 2025", "2025", "Mar 4, 2025". */
export declare function formatAsOf(asOf: string | null, precision: string): string;
export declare function buildCategoryDetail<T extends OntologyRecordLike>(context: DomainContext<T>, categoryId: string, members: readonly T[], calcs: readonly LineCalc[]): {
    table: MemberTable;
    schema: DomainSchema | null;
};
