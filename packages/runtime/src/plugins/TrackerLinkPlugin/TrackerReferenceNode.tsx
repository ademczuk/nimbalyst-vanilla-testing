/**
 * TrackerReferenceNode -- attaches the editor's React decorator to the
 * React-free class in `./TrackerReferenceNodeCore.ts` and re-exports it.
 *
 * The decorator dispatches to the host renderer registered with
 * `setTrackerReferenceNodeRenderer`, or shows the bare key when none is.
 */

import * as React from 'react';

import { TrackerReferenceNodeDecorator } from './TrackerReferenceNodeCore';
import { getTrackerReferenceNodeRenderer } from './TrackerReferenceNodeRenderer';

TrackerReferenceNodeDecorator.set((node) => {
  const Renderer = getTrackerReferenceNodeRenderer();
  if (!Renderer) {
    return (
      <span
        className="tracker-reference"
        data-issue-key={node.__referenceKey}
      >
        {node.__referenceKey}
      </span>
    );
  }
  return (
    <Renderer
      referenceKey={node.__referenceKey}
      nodeKey={node.getKey()}
      view={node.getView()}
    />
  );
});

export * from './TrackerReferenceNodeCore';
