/**
 * The plain sentence at the top of "What we track", and the request "Ask the
 * agent to suggest improvements" writes. Split from `ontologyDomain.ts`.
 */
import type { DomainCategory, DomainModel, SummaryPart } from './ontologyDomain';
/**
 * "Your team tracks 59 competitors across 11 markets and the 42 companies
 * behind them; what Nimbalyst can do, as 19 capabilities on 14 technologies;
 * who uses it, as 168 customers and 317 people; and the work: 345 open bugs,
 * 217 decisions, 72 plans."
 */
export declare function buildSummary(categories: readonly DomainCategory[], usName: string): SummaryPart[];
/** What "Ask the agent to suggest improvements" writes: every gap, for an agent to rank and draft. */
export declare function suggestStructureRequest(model: DomainModel): {
    title: string;
    request: string;
    healthCheck: string;
};
