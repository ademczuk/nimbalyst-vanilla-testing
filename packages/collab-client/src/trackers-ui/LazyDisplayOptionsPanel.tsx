import { lazy, Suspense, type ComponentProps, type JSX } from 'react';

type DisplayOptionsPanelComponent =
  typeof import('@nimbalyst/runtime/plugins/TrackerPlugin/components/DisplayOptionsPanel').DisplayOptionsPanel;

export type LazyDisplayOptionsPanelProps =
  ComponentProps<DisplayOptionsPanelComponent>;

const loadDisplayOptionsPanel = () =>
  import(
    '@nimbalyst/runtime/plugins/TrackerPlugin/components/DisplayOptionsPanel'
  );
const DisplayOptionsPanelImpl = lazy(() =>
  loadDisplayOptionsPanel().then((module) => ({
    default: module.DisplayOptionsPanel,
  }))
);

export function preloadDisplayOptionsPanel(): void {
  void loadDisplayOptionsPanel();
}

/** Keeps the visible Display trigger eager while loading its popover on intent. */
export function LazyDisplayOptionsPanel(
  props: LazyDisplayOptionsPanelProps
): JSX.Element {
  return (
    <Suspense fallback={null}>
      <DisplayOptionsPanelImpl {...props} />
    </Suspense>
  );
}
