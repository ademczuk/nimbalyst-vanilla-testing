import type { JSX } from 'react';
import type { ReferenceElement } from '@floating-ui/react';
import {
  FloatingPortal,
  useTrackerFloatingMenu,
} from '../useTrackerFloatingMenu';
import { TrackerActionList, type TrackerItemAction } from './TrackerActionList';

export interface TrackerItemActionsPopoverProps {
  actions: readonly TrackerItemAction[];
  reference: ReferenceElement;
  onClose: () => void;
}

/** The floating half of the header action menu, loaded after its eager trigger. */
export function TrackerItemActionsPopover({
  actions,
  reference,
  onClose,
}: TrackerItemActionsPopoverProps): JSX.Element {
  const menu = useTrackerFloatingMenu({
    placement: 'bottom-end',
    reference,
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });

  return (
    <FloatingPortal>
      <div
        ref={menu.refs.setFloating}
        style={menu.floatingStyles}
        {...menu.getFloatingProps()}
        className="tracker-item-actions-menu z-[60] min-w-[200px] overflow-hidden rounded-lg border border-nim bg-nim-secondary py-1 shadow-xl"
        data-testid="tracker-item-actions-menu"
      >
        <TrackerActionList actions={actions} onBeforeSelect={onClose} />
      </div>
    </FloatingPortal>
  );
}
