/**
 * Per-column filter editor for the tracker grid.
 *
 * Edits the clauses for a single column in the shared `{field, op, value}`
 * language, so what a user builds here is the same object saved into a view,
 * queried by the CLI, or passed to `tracker_list`.
 */
import type { JSX } from 'react';
import type { FieldDefinition } from '../../../../runtime/src/plugins/TrackerPlugin/models/index';
import { type TrackerFieldFilter } from '../../../../runtime/src/plugins/TrackerPlugin/models/index';
export interface TrackerColumnFilterPopoverProps {
    /** Column being filtered. */
    columnId: string;
    columnLabel: string;
    /** Schema field behind the column; drives which operators are offered. */
    field: FieldDefinition | undefined;
    /** Clauses currently applied to this column. */
    clauses: TrackerFieldFilter[];
    /** How every active column-filter clause combines. */
    combinator: 'and' | 'or';
    /** Header cell rect the popover anchors to. */
    anchorRect: DOMRect;
    onApply: (clauses: TrackerFieldFilter[], combinator: 'and' | 'or') => void;
    onClose: () => void;
}
export declare function TrackerColumnFilterPopover({ columnId, columnLabel, field, clauses, combinator: initialCombinator, anchorRect, onApply, onClose, }: TrackerColumnFilterPopoverProps): JSX.Element;
