/**
 * `DecisionNode` -- attaches the editor's React decorator to the React-free
 * class in `./DecisionNodeCore.ts` and re-exports it.
 */

import React from 'react';

import { DecisionNodeDecorator } from './DecisionNodeCore';

/**
 * Lazy so the six respond controls, their tally renderers, and dnd-kit stay out
 * of the initial bundle. The mobile editor deep-imports the editor precisely to
 * avoid dragging heavy renderers in, so this must not become eager.
 */
const DecisionComponent = React.lazy(() => import('./DecisionComponent'));

DecisionNodeDecorator.set((node, _editor, config) => {
  const embedBlockTheme = config.theme.embedBlock || {};
  return (
    <DecisionComponent
      className={embedBlockTheme.base || ''}
      content={node.__content}
      nodeKey={node.__key}
    />
  );
});

export * from './DecisionNodeCore';
