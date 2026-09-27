/**
 * MermaidNode - attaches the editor's React decorator to the React-free class
 * in `./MermaidNodeCore.ts` and re-exports it.
 */

import React from 'react';

import { MermaidNodeDecorator } from './MermaidNodeCore';

// Lazy-loaded component to avoid bundling mermaid when not needed
const MermaidComponent = React.lazy(() => import('./MermaidComponent'));

MermaidNodeDecorator.set((node, _editor, config) => {
  const embedBlockTheme = config.theme.embedBlock || {};
  const className = embedBlockTheme.base || '';

  return (
    <MermaidComponent
      className={className}
      content={node.__content}
      nodeKey={node.__key}
    />
  );
});

export * from './MermaidNodeCore';
