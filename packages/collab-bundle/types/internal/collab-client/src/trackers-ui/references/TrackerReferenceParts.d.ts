/**
 * Pieces shared by the live reference views: the inline chip, open handlers,
 * and field readers. Split out so the card and the state menu can live in
 * their own files without importing the view barrel.
 */
import type { JSX, KeyboardEvent, MouseEvent } from 'react';
import type { TrackerItem } from '../../trackers/dataSource';
import type { TrackerReferenceResolver, TrackerReferenceStatusInfo, TrackerReferenceTypeInfo, TrackerStatement } from './trackerReferenceResolver';
export interface ResolverProps {
    resolver: TrackerReferenceResolver;
    referenceKey: string;
}
export declare function openHandlers(resolver: TrackerReferenceResolver, itemId: string | null): {
    role?: undefined;
    tabIndex?: undefined;
    onClick?: undefined;
    onKeyDown?: undefined;
} | {
    role: "link";
    tabIndex: number;
    onClick: (event: MouseEvent | KeyboardEvent) => void;
    onKeyDown: (event: KeyboardEvent) => void;
};
export declare function TypeIcon({ typeInfo }: {
    typeInfo: TrackerReferenceTypeInfo;
}): JSX.Element | null;
export declare function StatusBadge({ status }: {
    status: TrackerReferenceStatusInfo | null;
}): JSX.Element | null;
export declare function displayKey(item: TrackerItem, fallback: string): string;
export declare function LiveChip({ resolver, referenceKey }: ResolverProps): JSX.Element;
export declare function text(resolver: TrackerReferenceResolver, item: TrackerItem, field: string): string | null;
export declare function plural(count: number, noun: string): string;
export declare function StatementObject({ resolver, statement, }: {
    resolver: TrackerReferenceResolver;
    statement: Pick<TrackerStatement, 'objectItemId' | 'valueText'>;
}): JSX.Element | null;
