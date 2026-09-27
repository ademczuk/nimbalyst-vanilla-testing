// The inspector (views, concept map, proposal drawer, styles) only renders on
// the Tracker setup screen, so it loads on first mount instead of riding in
// the trackers-ui entry that every tracker surface pays for.
import { lazy, Suspense } from 'react';
import type { OntologyInspectorProps } from './OntologyInspector';

const InspectorImpl = lazy(() =>
  import('./OntologyInspector').then((module) => ({ default: module.OntologyInspector })),
);

export function OntologyInspector(props: OntologyInspectorProps) {
  return (
    <Suspense fallback={null}>
      <InspectorImpl {...props} />
    </Suspense>
  );
}
