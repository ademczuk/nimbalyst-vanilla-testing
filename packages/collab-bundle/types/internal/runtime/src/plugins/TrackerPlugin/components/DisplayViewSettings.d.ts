/**
 * The view-defining half of Display Settings: view mode, the grouping axis the
 * board draws its columns from, and the ordering inside a group.
 *
 * Grouping options come from TRACKER_GROUPING_OPTIONS and ordering options from
 * the type's own sortable columns, so neither list can drift from the axes the
 * board actually resolves.
 */
import React from 'react';
import { type TrackerGroupBy } from '../models/trackerGrouping';
import { type TrackerOrdering } from '../models/trackerOrdering';
import type { TrackerColumnDef } from './trackerColumns';
/** One selectable view mode. The vocabulary is the caller's, not the panel's. */
export interface DisplayOptionsViewMode {
    value: string;
    label: string;
    icon: string;
}
interface DisplayViewSettingsProps {
    availableColumns: TrackerColumnDef[];
    viewModes?: readonly DisplayOptionsViewMode[];
    viewMode?: string;
    onViewModeChange?: (viewMode: string) => void;
    groupBy?: TrackerGroupBy;
    onGroupByChange?: (groupBy: TrackerGroupBy) => void;
    ordering?: TrackerOrdering;
    onOrderingChange?: (ordering: TrackerOrdering) => void;
}
export declare const DisplayViewSettings: React.FC<DisplayViewSettingsProps>;
export {};
