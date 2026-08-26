/**
 * The filterable-field view model shared by every filter affordance.
 *
 * It is a presentation shape, not a schema shape: options carry counts, colors,
 * and icons the schema has no opinion about, and the grouping is how the menu
 * lists them. It lived inside `TrackerViewHeaderControls` and was imported from
 * there by the omnibox and the active-filter pills, which made a 586-line
 * component a type dependency of two small ones.
 */
import type { FieldType } from '../../../runtime/src/plugins/TrackerPlugin/models/index';
export interface TrackerFilterFieldOption {
    value: string;
    label: string;
    count?: number;
    color?: string;
    icon?: string;
}
export interface TrackerFilterField {
    id: string;
    label: string;
    type?: FieldType;
    multiValue?: boolean;
    options?: TrackerFilterFieldOption[];
    group?: 'common' | 'custom' | 'system';
}
