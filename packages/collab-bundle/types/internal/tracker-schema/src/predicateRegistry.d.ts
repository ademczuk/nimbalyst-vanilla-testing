/**
 * Predicate registry (knowledge-scopes contract 4.1).
 *
 * A predicate is the verb in a statement: `product --integrates-with--> product`,
 * qualified by "via which connector", "which operations", "tested against which
 * client version". The registry is the declaration of those verbs, and it is a
 * SCHEMA ARTIFACT, not project configuration. Per decision 12 the room owns it
 * and publishes it to every client exactly like a type definition;
 * `.nimbalyst/predicates.yaml` is a local copy, never the distribution
 * mechanism. The transport lives in `schemaSyncPayload.ts` and rides the lane
 * type definitions already ride.
 *
 * This module is pure: plain objects in, issues out. It is reachable from
 * desktop, the web console, the collab server (which depends on this package
 * for C3/C4/C5), and both MCP surfaces, which is the whole point -- section 7
 * requires that "a predicate with required qualifiers rejects a claim missing
 * them" report the SAME code on all four.
 *
 * Three properties shape this file, and they are the same three that shape
 * `./citationLocator.ts` for the same reasons.
 *
 * **Stable codes.** Every failure carries a `PREDICATE_*` code and a property
 * path. A message is for a person; a code is what a caller may branch on.
 *
 * **Strict in both directions.** An unknown qualifier, an unknown property on a
 * predicate declaration, and an unknown qualifier type are all rejections. The
 * concrete failure a tolerant reader produces here: `operation` for
 * `operations` is dropped, the required qualifier reads as missing, and the
 * author is told to supply a qualifier they believe they just supplied. Worse,
 * with `required` absent it is accepted and the statement claims a precision
 * nobody wrote.
 *
 * **Every issue in one pass.** A form or an MCP caller fixes a value in one
 * round trip rather than one per property.
 *
 * What this module does NOT do: resolve a relationship target, read items, or
 * decide whether a registry change is safe. That last one is
 * `./trackerPredicateRegistryChangeClassifier.ts`, which applies the same
 * additive-versus-destructive rule type schemas already get.
 */
/**
 * What the object of a statement is. A predicate's value shape and the field
 * carrying it have to agree, or the field stores something the predicate does
 * not describe. See {@link predicateValueShapeAcceptsFieldType}.
 */
export type PredicateValueShape = 'entity' | 'text' | 'boolean-assessment' | 'quantity' | 'select';
export declare const PREDICATE_VALUE_SHAPES: readonly PredicateValueShape[];
/** `symmetric` reads the same both ways (`relates-to`); `directed` does not. */
export type PredicateDirection = 'directed' | 'symmetric';
export declare const PREDICATE_DIRECTIONS: readonly PredicateDirection[];
export type PredicateQualifierType = 'string' | 'number' | 'boolean' | 'date' | 'select' | 'relationship' | 'array';
export declare const PREDICATE_QUALIFIER_TYPES: readonly PredicateQualifierType[];
/** Item types an `array` qualifier may hold. Nested objects are deliberately absent. */
export type PredicateQualifierItemType = 'string' | 'number' | 'boolean';
export declare const PREDICATE_QUALIFIER_ITEM_TYPES: readonly PredicateQualifierItemType[];
export interface PredicateQualifierDefinition {
    type: PredicateQualifierType;
    /** Absent means optional. A qualifier becoming required is a destructive change. */
    required?: boolean;
    /** For `array`. Absent accepts any of {@link PREDICATE_QUALIFIER_ITEM_TYPES}. */
    itemType?: PredicateQualifierItemType;
    /** For `select`. Values, not labels: a qualifier is data, not presentation. */
    options?: string[];
    /** For `relationship`. Allowed target tracker types, or `'*'` for any. */
    targetTrackerTypes?: string[] | '*';
    /** Presentation only; never affects validation or change classification. */
    label?: string;
    /** Presentation only. */
    description?: string;
}
export interface PredicateDefinition {
    id: string;
    label: string;
    /** How the statement reads from the object's side. Presentation only. */
    inverseLabel?: string;
    /**
     * Tracker types that may be the subject. `['*']` accepts any. A derived type
     * satisfies a base listed here -- see {@link isSubjectKindAllowed} -- which is
     * what lets a workspace declare predicates against `entity` while
     * domain-specific schemas narrow the kinds that extend it.
     */
    subjectKinds: string[];
    valueShape: PredicateValueShape;
    direction: PredicateDirection;
    /** Advisory for traversal; nothing in this package walks a transitive closure. */
    transitive?: boolean;
    qualifiers?: Record<string, PredicateQualifierDefinition>;
}
export type PredicateErrorCode = 'PREDICATE_NOT_AN_OBJECT' | 'PREDICATE_MISSING_FIELD' | 'PREDICATE_INVALID_FIELD' | 'PREDICATE_UNKNOWN_FIELD' | 'PREDICATE_DUPLICATE_ID' | 'PREDICATE_REGISTRY_NOT_AN_ARRAY' | 'PREDICATE_UNKNOWN' | 'PREDICATE_VALUE_SHAPE_MISMATCH' | 'PREDICATE_SUBJECT_KIND_NOT_ALLOWED' | 'PREDICATE_QUALIFIERS_NOT_AN_OBJECT' | 'PREDICATE_QUALIFIER_REQUIRED' | 'PREDICATE_QUALIFIER_UNKNOWN' | 'PREDICATE_QUALIFIER_INVALID_TYPE' | 'PREDICATE_QUALIFIER_INVALID_OPTION';
export interface PredicateIssue {
    code: PredicateErrorCode;
    /** The offending property, or `''` when the subject as a whole is at fault. */
    path: string;
    message: string;
}
export type PredicateDefinitionValidation = {
    valid: true;
    predicate: PredicateDefinition;
    issues: [];
} | {
    valid: false;
    predicate: null;
    issues: PredicateIssue[];
};
/**
 * Validate one predicate declaration. Returns the narrowed definition on
 * success and every issue on failure, never a partially-accepted value: a
 * predicate missing half its qualifier declarations validates writes against a
 * contract nobody authored.
 */
export declare function validatePredicateDefinition(value: unknown): PredicateDefinitionValidation;
export type PredicateRegistryValidation = {
    valid: true;
    predicates: PredicateDefinition[];
    issues: [];
} | {
    valid: false;
    predicates: null;
    issues: PredicateIssue[];
};
/**
 * Validate a whole registry. Entry issues are prefixed with the index, and a
 * duplicate id is reported on the later entry: two declarations of one verb
 * means every write validates against whichever happened to be registered last.
 */
export declare function validatePredicateRegistry(value: unknown): PredicateRegistryValidation;
/**
 * Whether `type` may be the subject of a predicate declaring `subjectKinds`.
 *
 * `baseOf` walks the `extends` chain, so a predicate declared against `entity`
 * accepts `product extends entity` with no edit to the predicate. Without this
 * every pack would have to restate its predicates for each derived kind, which
 * is the drift N5's inheritance resolver exists to prevent.
 *
 * Depth is bounded because a corrupted chain must not hang a write path; the
 * inheritance resolver rejects cycles, and this is the second line.
 */
export declare function isSubjectKindAllowed(subjectKinds: readonly string[], type: string, baseOf?: (type: string) => string | undefined): boolean;
/**
 * Whether a field of `fieldType` can carry a predicate of `valueShape`.
 *
 * Today only `entity` is exercised: 4.1 attaches `predicate` to a relationship
 * field, whose value IS the object of the statement. The rest of the table is
 * stated because the `claim` kind (N11) carries `value` shaped per its
 * predicate, and leaving the mapping implicit is how the two halves drift.
 */
export declare function predicateValueShapeAcceptsFieldType(valueShape: PredicateValueShape, fieldType: string): boolean;
export type PredicateQualifiersValidation = {
    valid: true;
    issues: [];
} | {
    valid: false;
    issues: PredicateIssue[];
};
/**
 * Validate the qualifier bag on one statement against its predicate.
 *
 * `undefined` is treated as an empty bag rather than as "skip": a predicate
 * with a required qualifier must reject a statement that omits the bag
 * entirely, which is the acceptance gate in section 7 verbatim.
 */
export declare function validatePredicateQualifiers(predicate: PredicateDefinition, value: unknown): PredicateQualifiersValidation;
export interface PredicateFieldDeclarationContext {
    /** Tracker type declaring the field: the subject of every statement it holds. */
    ownerType: string;
    /** The field's `type`, checked against the predicate's value shape. */
    fieldType: string;
    /** Resolve a tracker type's `extends` base, for {@link isSubjectKindAllowed}. */
    baseOf?: (type: string) => string | undefined;
}
/**
 * Validate a field's `predicate:` against the registry, at the moment the type
 * is declared rather than at the moment an item is written.
 *
 * This is deliberately separate from qualifier validation. A value-shape or
 * subject-kind mismatch is a defect in the SCHEMA, and reporting it on every
 * item write would point the author at data that is fine. `tracker_define_type`
 * and the schema editor call this; the write path calls
 * {@link validatePredicateQualifiers}.
 */
export declare function validatePredicateFieldDeclaration(predicateId: string, predicate: PredicateDefinition | undefined, context: PredicateFieldDeclarationContext): PredicateIssue[];
/** The subset of a tracker type this check needs, so it stays free of the model. */
export interface PredicateDeclaringType {
    type: string;
    extends?: string;
    fields: ReadonlyArray<{
        name: string;
        type: string;
        predicate?: string;
    }>;
}
/**
 * Check every `predicate:` a type declares against the registry, at the moment
 * the type is authored.
 *
 * Issue paths are `fields.<name>.predicate`, so an authoring surface can point
 * at the row that is wrong rather than reporting "the schema is invalid".
 */
export declare function validateTrackerTypePredicateDeclarations(model: PredicateDeclaringType, lookup: (id: string) => PredicateDefinition | undefined, baseOf?: (type: string) => string | undefined): PredicateIssue[];
