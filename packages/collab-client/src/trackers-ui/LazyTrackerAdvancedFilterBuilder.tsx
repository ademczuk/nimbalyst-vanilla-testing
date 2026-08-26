import { lazy, Suspense, type JSX } from 'react';
import type { TrackerAdvancedFilterBuilderProps } from './TrackerAdvancedFilterBuilder';

const loadTrackerAdvancedFilterBuilder = () =>
  import('./TrackerAdvancedFilterBuilder');
const TrackerAdvancedFilterBuilderImpl = lazy(() =>
  loadTrackerAdvancedFilterBuilder().then((module) => ({
    default: module.TrackerAdvancedFilterBuilder,
  }))
);

export function preloadTrackerAdvancedFilterBuilder(): void {
  void loadTrackerAdvancedFilterBuilder();
}

/** Loads the advanced builder only after the reader asks to open it. */
export function LazyTrackerAdvancedFilterBuilder(
  props: TrackerAdvancedFilterBuilderProps
): JSX.Element {
  return (
    <Suspense fallback={null}>
      <TrackerAdvancedFilterBuilderImpl {...props} />
    </Suspense>
  );
}
