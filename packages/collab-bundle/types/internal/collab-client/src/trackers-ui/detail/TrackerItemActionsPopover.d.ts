import type { JSX } from 'react';
import type { ReferenceElement } from '@floating-ui/react';
import { type TrackerItemAction } from './TrackerActionList';
export interface TrackerItemActionsPopoverProps {
    actions: readonly TrackerItemAction[];
    reference: ReferenceElement;
    onClose: () => void;
}
/** The floating half of the header action menu, loaded after its eager trigger. */
export declare function TrackerItemActionsPopover({ actions, reference, onClose, }: TrackerItemActionsPopoverProps): JSX.Element;
