import { useMemo, type JSX } from 'react';
import { FloatingFocusManager } from '@floating-ui/react';
import {
  FloatingPortal,
  useTrackerFloatingMenu,
} from '../useTrackerFloatingMenu';
import { TrackerActionList } from './TrackerActionList';
import type { TrackerContextMenuProps } from './TrackerContextMenu';

/** Floating implementation kept out of the eager graph until a right-click. */
export function TrackerContextMenuPopover({
  point,
  actions,
  onClose,
  label = 'Item actions',
  className,
}: TrackerContextMenuProps): JSX.Element | null {
  const reference = useMemo(
    () =>
      point
        ? {
            getBoundingClientRect: () => ({
              width: 0,
              height: 0,
              x: point.x,
              y: point.y,
              top: point.y,
              left: point.x,
              right: point.x,
              bottom: point.y,
            }),
          }
        : null,
    [point]
  );

  const menu = useTrackerFloatingMenu({
    placement: 'right-start',
    offsetPx: 2,
    reference,
    open: point !== null,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });

  if (!point) return null;

  return (
    <FloatingPortal>
      <FloatingFocusManager
        context={menu.context}
        modal={false}
        initialFocus={-1}
        returnFocus={false}
      >
        <div
          ref={menu.refs.setFloating}
          style={menu.floatingStyles}
          {...menu.getFloatingProps()}
          aria-label={label}
          className={`tracker-context-menu z-[60] min-w-[200px] overflow-auto rounded-lg border border-nim bg-nim-secondary py-1 shadow-xl ${
            className ?? ''
          }`}
          data-testid="tracker-context-menu"
        >
          <TrackerActionList actions={actions} onBeforeSelect={onClose} />
        </div>
      </FloatingFocusManager>
    </FloatingPortal>
  );
}
