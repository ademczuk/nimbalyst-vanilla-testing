/**
 * Classify the difference between two predicate registries as additive (safe,
 * applies instantly) or destructive (needs a confirm carrying a blast radius).
 *
 * Contract 4.1: "additive versus destructive classification applies to registry
 * changes exactly as to type schemas". This module is the registry half of
 * `./trackerSchemaChangeClassifier.ts` and follows its rule verbatim: anything
 * that is not a PROVEN widening is destructive. A wrong "additive" silently
 * invalidates statements already written on teammates' items; a wrong
 * "destructive" costs a confirm click.
 *
 * Deliberately a sibling module rather than a branch inside the schema
 * classifier. The two diff different artifacts against different rules and
 * share only the verdict vocabulary; folding them together would mean one
 * function whose `previous` and `next` are sometimes a model and sometimes a
 * registry, which is how a rule gets applied to the wrong shape.
 *
 * Presentation is never a change: `label`, `inverseLabel`, and a qualifier's
 * `label` and `description` classify as nothing, exactly as field labels,
 * colors, and icons do on a type schema.
 *
 * The three cases 4.1 calls out are all destructive here, and each for a reason
 * that names what breaks:
 *
 *  - **Removing a predicate.** Every field declaring it stops validating and
 *    every statement written under it loses the contract it was written to.
 *  - **Narrowing `subjectKinds`.** A type that was a legal subject no longer
 *    is, so its existing statements are now unauthorized by the registry.
 *  - **Making a qualifier required.** Every statement written before the change
 *    omits it, so the whole existing corpus becomes invalid at once.
 */
import type { PredicateDefinition, PredicateQualifierDefinition } from './predicateRegistry.js';
interface PredicateChange {
    predicateId: string;
}
export type AdditivePredicateRegistryChange = (PredicateChange & {
    kind: 'predicate-added';
    predicate: PredicateDefinition;
}) | (PredicateChange & {
    kind: 'qualifier-added';
    qualifierName: string;
    qualifier: PredicateQualifierDefinition;
}) | (PredicateChange & {
    kind: 'qualifier-made-optional';
    qualifierName: string;
}) | (PredicateChange & {
    kind: 'qualifier-option-added';
    qualifierName: string;
    option: string;
}) | (PredicateChange & {
    kind: 'subject-kinds-widened';
    previousValue: string[];
    nextValue: string[];
});
export type DestructivePredicateRegistryChange = (PredicateChange & {
    kind: 'predicate-removed';
    predicate: PredicateDefinition;
}) | (PredicateChange & {
    kind: 'qualifier-removed';
    qualifierName: string;
    qualifier: PredicateQualifierDefinition;
}) | (PredicateChange & {
    kind: 'qualifier-made-required';
    qualifierName: string;
}) | (PredicateChange & {
    kind: 'qualifier-type-changed';
    qualifierName: string;
    previousType: string;
    nextType: string;
}) | (PredicateChange & {
    kind: 'qualifier-option-removed';
    qualifierName: string;
    option: string;
}) | (PredicateChange & {
    kind: 'qualifier-definition-changed';
    qualifierName: string;
    previousQualifier: PredicateQualifierDefinition;
    nextQualifier: PredicateQualifierDefinition;
}) | (PredicateChange & {
    kind: 'subject-kinds-narrowed';
    previousValue: string[];
    nextValue: string[];
}) | (PredicateChange & {
    kind: 'value-shape-changed';
    previousValue: string;
    nextValue: string;
}) | (PredicateChange & {
    kind: 'direction-changed';
    previousValue: string;
    nextValue: string;
});
export type PredicateRegistryChange = AdditivePredicateRegistryChange | DestructivePredicateRegistryChange;
export declare function isDestructivePredicateRegistryChange(change: PredicateRegistryChange): change is DestructivePredicateRegistryChange;
export declare function destructivePredicateRegistryChanges(changes: readonly PredicateRegistryChange[]): DestructivePredicateRegistryChange[];
export interface PredicateRegistryChangeClassification {
    /** The verdict a write path gates on; stated once here, not re-derived per caller. */
    classification: 'none' | 'additive' | 'destructive';
    changes: PredicateRegistryChange[];
}
/**
 * Classify the data-bearing differences between two predicate registries.
 *
 * Both inputs are the VALIDATED form. Classifying an unvalidated registry would
 * compare against declarations that may never have been accepted, which reports
 * a change nobody made.
 */
export declare function classifyPredicateRegistryChanges(previous: readonly PredicateDefinition[], next: readonly PredicateDefinition[]): PredicateRegistryChangeClassification;
export {};
