import { type JSX, type ReactNode } from 'react';
import type { TrackerBacklink, TrackerReferenceResolution, TrackerReferenceResolver, TrackerStatementGroup } from './trackerReferenceResolver';
/**
 * The resolver live reference views read. Null means the host supplied none,
 * and the views fall back to the store-free key-only chip.
 */
export declare const TrackerReferenceResolverContext: import("react").Context<TrackerReferenceResolver | null>;
export declare function TrackerReferenceResolverProvider({ resolver, children, }: {
    resolver: TrackerReferenceResolver | null | undefined;
    children: ReactNode;
}): JSX.Element;
export declare function useTrackerReferenceResolver(): TrackerReferenceResolver | null;
export declare function useTrackerReference(resolver: TrackerReferenceResolver, key: string): TrackerReferenceResolution;
export declare function useTrackerStatements(resolver: TrackerReferenceResolver, itemId: string): readonly TrackerStatementGroup[];
export declare function useTrackerBacklinks(resolver: TrackerReferenceResolver, itemId: string): readonly TrackerBacklink[];
