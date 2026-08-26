import type { JSX } from 'react';
import { type TrackerFilterSet } from '../../../runtime/src/plugins/TrackerPlugin/models/index';
import type { TrackerFilterField } from './trackerFilterFields';
interface TrackerActiveFilterPillsProps {
    fields: TrackerFilterField[];
    filters: TrackerFilterSet | null;
    onManage: () => void;
    onRemove: (clauseIndex: number) => void;
}
export declare function TrackerActiveFilterPills({ fields, filters, onManage, onRemove, }: TrackerActiveFilterPillsProps): JSX.Element | null;
export {};
