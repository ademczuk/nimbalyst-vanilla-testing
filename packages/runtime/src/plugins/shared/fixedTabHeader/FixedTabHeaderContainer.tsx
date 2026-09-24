import { useEffect, useState, memo, useRef } from 'react';
import type { LexicalEditor } from 'lexical';
import { FixedTabHeaderRegistry } from './FixedTabHeaderRegistry';
import type { FixedTabHeaderProvider, TabContext } from './types';
import './FixedTabHeader.css';

interface FixedTabHeaderContainerProps {
  filePath: string;
  fileName: string;
  editor?: LexicalEditor;
}

function FixedTabHeaderContainerComponent({
  filePath,
  fileName,
  editor,
}: FixedTabHeaderContainerProps) {
  const [providers, setProviders] = useState<FixedTabHeaderProvider[]>([]);
  const [updateTrigger, setUpdateTrigger] = useState(0);

  // Update providers when filePath, fileName, editor, or updateTrigger changes
  useEffect(() => {
    const context: TabContext = {
      filePath,
      fileName,
      editor,
    };

    const registry = FixedTabHeaderRegistry.getInstance();
    const activeProviders = registry.getProviders(context);
    setProviders(activeProviders);
  }, [filePath, fileName, editor, updateTrigger]);

  // Listen to editor updates to re-evaluate shouldRender (for dynamic conditions like $hasDiffNodes)
  // Use a ref to throttle updates and prevent re-rendering on every keystroke
  // Note: Only Lexical editors have registerUpdateListener
  useEffect(() => {
    if (!editor) return;

    // Check if this is a Lexical editor (has registerUpdateListener method)
    if (typeof (editor as any).registerUpdateListener !== 'function') {
      // Not a Lexical editor (probably Monaco), skip update listener
      return;
    }

    let timeoutId: NodeJS.Timeout | null = null;

    const unregister = editor.registerUpdateListener(() => {
      // Throttle re-evaluation to avoid constant re-renders
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        setUpdateTrigger(prev => prev + 1);
        timeoutId = null;
      }, 100); // Wait 100ms after last edit before re-evaluating
    });

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unregister();
    };
  }, [editor]);

  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="fixed-tab-header-container">
      {providers.map((provider) => {
        const Component = provider.component;
        return (
          <Component
            key={provider.id}
            filePath={filePath}
            fileName={fileName}
            editor={editor}
          />
        );
      })}
    </div>
  );
}

// Shallow memo: skip parent re-renders, but re-render on a new editor instance.
// The Lexical editor is rebuilt on a raw/rich toggle, diff-mode swap, or extension
// reload; holding the first instance left the find bar searching a destroyed
// editor that could count matches but never highlight or scroll to them (#1578).
export const FixedTabHeaderContainer = memo(FixedTabHeaderContainerComponent);
