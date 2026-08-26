import { lazy, Suspense, type JSX } from 'react';
import type { TrackerFilterValueMenuProps } from './TrackerFilterValueMenu';

const loadTrackerFilterValueMenu = () => import('./TrackerFilterValueMenu');
const TrackerFilterValueMenuImpl = lazy(() =>
  loadTrackerFilterValueMenu().then((module) => ({
    default: module.TrackerFilterValueMenu,
  }))
);

export function preloadTrackerFilterValueMenu(): void {
  void loadTrackerFilterValueMenu();
}

/** Loads floating positioning only after a filter field is chosen. */
export function LazyTrackerFilterValueMenu(
  props: TrackerFilterValueMenuProps
): JSX.Element {
  return (
    <Suspense fallback={null}>
      <TrackerFilterValueMenuImpl {...props} />
    </Suspense>
  );
}
