import type { TrackerFieldDefinition } from "./context.js";
export interface TrackerRelationshipValue {
    itemId: string;
    issueKey?: string;
    title?: string;
    trackerType?: string;
    relationshipTypeKey?: string;
    direction?: "out";
    metadata?: Record<string, unknown>;
}
export declare function isRelationshipField(def: Pick<TrackerFieldDefinition, "type">): boolean;
export declare function normalizeRelationshipValue(raw: unknown): TrackerRelationshipValue[];
