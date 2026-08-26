/**
 * The column-property half of Display Settings: which columns are visible, in
 * which order (drag-reorderable), and which are hidden. Split out of
 * DisplayOptionsPanel so the panel itself stays a layout of view settings.
 */
import React from 'react';
import type { TrackerColumnDef, TypeColumnConfig } from './trackerColumns';
interface DisplayOptionsColumnListProps {
    availableColumns: TrackerColumnDef[];
    config: TypeColumnConfig;
    onConfigChange: (config: TypeColumnConfig) => void;
}
export declare const DisplayOptionsColumnList: React.FC<DisplayOptionsColumnListProps>;
export {};
