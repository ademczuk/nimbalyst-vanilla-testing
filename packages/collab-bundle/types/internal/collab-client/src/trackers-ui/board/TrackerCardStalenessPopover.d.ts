import { type JSX } from 'react';
import { type ReferenceElement } from '@floating-ui/react';
import type { TrackerRecord } from '../../../../runtime/src/core/TrackerRecord';
export interface TrackerCardStalenessPopoverProps {
    item: TrackerRecord;
    reference: ReferenceElement;
    onClose: () => void;
}
/** Evidence popover loaded only after the staleness chip is activated. */
export declare function TrackerCardStalenessPopover({ item, reference, onClose, }: TrackerCardStalenessPopoverProps): JSX.Element | null;
