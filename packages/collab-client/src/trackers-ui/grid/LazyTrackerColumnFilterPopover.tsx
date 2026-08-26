import { lazy, Suspense, type JSX } from 'react';
import type { TrackerColumnFilterPopoverProps } from './TrackerColumnFilterPopover';

const loadTrackerColumnFilterPopover = () =>
  import('./TrackerColumnFilterPopover');
const TrackerColumnFilterPopoverImpl = lazy(() =>
  loadTrackerColumnFilterPopover().then((module) => ({
    default: module.TrackerColumnFilterPopover,
  }))
);

/** A column filter has no UI until its header affordance is activated. */
export function LazyTrackerColumnFilterPopover(
  props: TrackerColumnFilterPopoverProps
): JSX.Element {
  return (
    <Suspense fallback={null}>
      <TrackerColumnFilterPopoverImpl {...props} />
    </Suspense>
  );
}
