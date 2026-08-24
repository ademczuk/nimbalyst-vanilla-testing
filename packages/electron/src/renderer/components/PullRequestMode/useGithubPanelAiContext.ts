/**
 * Publishes whatever the GitHub panel currently has selected through the
 * editor-context store, under a synthetic path so the chip is scoped to this
 * panel and cleared when the selection goes away or the panel is hidden.
 *
 * Shared by the PR and issue lists — only the path, the identity card, and the
 * `fileType` differ.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { EditorContextItem } from '@nimbalyst/runtime';
import type { SerializableDocumentContext } from '../../hooks/useDocumentContext';
import {
  getActiveEditorContextItems,
  setEditorContextItems,
} from '../../stores/editorContextStore';

export interface GithubPanelAiContext {
  documentContext: SerializableDocumentContext;
  getDocumentContext: () => Promise<SerializableDocumentContext>;
}

/**
 * @param path  Synthetic document path, or '' while nothing should be published.
 * @param item  Identity card for the selection; null publishes nothing.
 */
export function useGithubPanelAiContext(
  path: string,
  item: EditorContextItem | null,
  fileType: string,
): GithubPanelAiContext {
  const activePathRef = useRef('');

  useEffect(() => {
    const previousPath = activePathRef.current;
    if (previousPath && previousPath !== path) {
      setEditorContextItems(previousPath, null);
    }

    if (path && item) {
      setEditorContextItems(path, [item]);
    }
    activePathRef.current = path;
  }, [item, path]);

  useEffect(() => () => {
    if (activePathRef.current) {
      setEditorContextItems(activePathRef.current, null);
      activePathRef.current = '';
    }
  }, []);

  const documentContext = useMemo<SerializableDocumentContext>(() => ({
    filePath: path,
    fileType,
    content: '',
  }), [path, fileType]);

  const getDocumentContext = useCallback(async (): Promise<SerializableDocumentContext> => ({
    ...documentContext,
    editorContextItems: path ? getActiveEditorContextItems(path) : undefined,
  }), [documentContext, path]);

  return { documentContext, getDocumentContext };
}
