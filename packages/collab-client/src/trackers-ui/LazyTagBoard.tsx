import { lazy, Suspense, type JSX } from 'react';
import type { TagBoardProps } from './TagBoard';
import { TrackerSurfaceMessage } from './primitives/TrackerSurfaceMessage';

const loadTagBoard = () => import('./TagBoard');
const TagBoardImpl = lazy(() =>
  loadTagBoard().then((module) => ({ default: module.TagBoard }))
);

export function preloadTagBoard(): void {
  void loadTagBoard();
}

/** The tag board is a selected view mode, not part of the cold tracker route. */
export function LazyTagBoard(props: TagBoardProps): JSX.Element {
  return (
    <Suspense
      fallback={
        <TrackerSurfaceMessage icon="sell" message="Loading tag board…" />
      }
    >
      <TagBoardImpl {...props} />
    </Suspense>
  );
}
