import { type OntologyRecordLike } from './ontologyRecords';
export type DomainGroupId = 'market' | 'product' | 'customers' | 'work';
export interface CategoryCopy {
    id: string;
    name: string;
    singular: string;
    group: DomainGroupId;
    role: string;
    blurb: string;
}
export declare const GROUP_COPY: Record<DomainGroupId, {
    label: string;
    question: (us: string) => string;
}>;
export declare const KNOWLEDGE_COPY: Record<string, CategoryCopy>;
export declare const KIND_CATEGORY: Record<string, string>;
/** Work trackers with a place on the page. Every other type with items is a chip under "Also tracked". */
export declare const WORK_COPY: Record<string, CategoryCopy>;
export declare const PERSONA_COPY: CategoryCopy;
/** The retired competitor tracker would otherwise read as a second "Competitors". */
export declare const TYPE_CHIP_NAMES: Record<string, string>;
/** Types the knowledge categories already cover, or that are the inspector's own bookkeeping. */
export declare const HIDDEN_TYPES: ReadonlySet<string>;
/** Verbs for relationship fields whose key alone reads badly. `type.field` -> plural present tense. */
export declare const FIELD_VERBS: Record<string, string>;
export declare const KEY_VERBS: Record<string, string>;
/** Knowledge predicates as verbs, read from the subject's end and the object's. */
export declare const PREDICATE_VERBS: Record<string, [string, string]>;
export declare const BUILT_ON: string[];
export declare const SIZE_FACTS: string[];
export declare const FACT_NOUNS: Record<string, [string, string]>;
export declare const THREAT_RANK: Record<string, number>;
export declare const INACTIVE_CLAIM: ReadonlySet<string>;
export declare const CLOSED_CATEGORIES: ReadonlySet<string>;
export declare const NAME_LIST = 4;
export declare function formatCount(value: number): string;
export declare function capitalize(value: string): string;
/** "sit in" -> "sits in", "are made by" -> "is made by": the verb after one subject. */
export declare function singularVerb(verb: string): string;
/** "Aider, Paseo, CodexMonitor, and 9 more." */
export declare function nameList(records: readonly OntologyRecordLike[], limit?: number): string;
export declare function humanize(value: string): string;
export declare function fill(template: string, us: string): string;
