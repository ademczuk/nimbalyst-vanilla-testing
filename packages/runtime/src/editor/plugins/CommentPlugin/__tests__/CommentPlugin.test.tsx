import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { $wrapSelectionInMarkNode, MarkNode } from '@lexical/mark';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  type LexicalEditor,
} from 'lexical';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Doc, Map as YMap } from 'yjs';

import { useCommentToolbarActions } from '../../../Editor';
import type { CommentsConfig } from '../../../commenting/types';
import { INSERT_INLINE_COMMENT_COMMAND } from '../../../extensions/builtin/CommentsExtension';
import CommentsPlugin from '../index';
import { OPEN_COMMENT_COMPOSER_COMMAND } from '../commands';

function TestEditorBridge({
  onReady,
  onInsertInlineComment,
}: {
  onReady: (editor: LexicalEditor) => void;
  onInsertInlineComment?: () => void;
}): null {
  const [editor] = useLexicalComposerContext();
  onReady(editor);

  useEffect(
    () =>
      editor.registerCommand(
        INSERT_INLINE_COMMENT_COMMAND,
        ({ id, isBackward }) => {
          onInsertInlineComment?.();
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $wrapSelectionInMarkNode(selection, isBackward, id);
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor, onInsertInlineComment],
  );

  return null;
}

const commentsConfig: CommentsConfig = {
  getYDoc: () => null,
  currentUser: { id: 'user-1', name: 'Test User' },
  getMembers: () => [],
  documentTitle: 'Shared document',
  documentId: 'doc-1',
  documentUri: 'collab://org:test:doc:doc-1',
};

describe('CommentsPlugin', () => {
  let paneElem: HTMLDivElement | undefined;

  afterEach(() => {
    paneElem?.remove();
    paneElem = undefined;
  });

  it('opens one new-comment composer in the docked panel', async () => {
    paneElem = document.createElement('div');
    const anchorElem = document.createElement('div');
    paneElem.append(anchorElem);
    document.body.append(paneElem);
    const yDoc = new Doc();

    let editor: LexicalEditor | undefined;
    render(
      <LexicalComposer
        initialConfig={{
          namespace: 'comments-panel-test',
          nodes: [MarkNode],
          theme: {},
          onError: (error) => {
            throw error;
          },
        }}
      >
        <TestEditorBridge onReady={(value) => (editor = value)} />
        <CommentsPlugin
          config={{ ...commentsConfig, getYDoc: () => yDoc }}
          anchorElem={anchorElem}
        />
      </LexicalComposer>,
    );

    if (!editor) throw new Error('editor not initialized');
    const mountedEditor = editor;

    await act(async () => {
      mountedEditor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode('Selected text');
          paragraph.append(text);
          $getRoot().append(paragraph);
          text.select(0, text.getTextContentSize());
        },
        { discrete: true },
      );
    });

    await act(async () => {
      mountedEditor.dispatchCommand(OPEN_COMMENT_COMPOSER_COMMAND, undefined);
    });

    await waitFor(() => {
      expect(
        paneElem?.querySelector('[data-testid="comments-panel"]'),
      ).not.toBeNull();
    });

    // One composer, and it is the docked one: the popover variant opening
    // alongside it is the regression this guards.
    expect(
      document.querySelectorAll('[data-testid="comment-composer"]'),
    ).toHaveLength(1);
    expect(document.querySelector('.nim-comment-composer-popover')).toBeNull();
    const sharedThread = yDoc.getArray('comments').get(0);
    expect(sharedThread).toBeInstanceOf(YMap);
    expect((sharedThread as YMap<unknown>).get('anchor')).toEqual({
      kind: 'text-quote',
      exact: 'Selected text',
    });

    fireEvent.click(
      paneElem?.querySelector('.nim-comment-btn-cancel') as HTMLButtonElement,
    );
    await waitFor(() => {
      expect(
        paneElem?.querySelector('[data-testid="comment-thread"]'),
      ).toBeNull();
    });
    expect(
      document.querySelector('[data-testid="comment-composer"]'),
    ).toBeNull();
  });

  // Access is revoked mid-session (`serverAccess: 'revoked'`) without the host
  // rebuilding its config object, so the command must read the live capability.
  it('refuses a stale comment command when access is revoked mid-session', async () => {
    paneElem = document.createElement('div');
    const anchorElem = document.createElement('div');
    paneElem.append(anchorElem);
    document.body.append(paneElem);

    const capabilities = { read: true, comment: true };
    const config: CommentsConfig = {
      ...commentsConfig,
      getCapabilities: () => capabilities,
    };

    let editor: LexicalEditor | undefined;
    const onInsertInlineComment = vi.fn();
    render(
      <LexicalComposer
        initialConfig={{
          namespace: 'comments-capability-test',
          nodes: [MarkNode],
          theme: {},
          onError: (error) => {
            throw error;
          },
        }}
      >
        <TestEditorBridge
          onReady={(value) => (editor = value)}
          onInsertInlineComment={onInsertInlineComment}
        />
        <CommentsPlugin config={config} anchorElem={anchorElem} />
      </LexicalComposer>,
    );

    if (!editor) throw new Error('editor not initialized');
    const mountedEditor = editor;

    await act(async () => {
      mountedEditor.update(
        () => {
          const paragraph = $createParagraphNode();
          const text = $createTextNode('Selected text');
          paragraph.append(text);
          $getRoot().append(paragraph);
          text.select(0, text.getTextContentSize());
        },
        { discrete: true },
      );
    });

    capabilities.comment = false;

    await act(async () => {
      mountedEditor.dispatchCommand(OPEN_COMMENT_COMPOSER_COMMAND, undefined);
    });
    expect(onInsertInlineComment).not.toHaveBeenCalled();
  });
});

describe('useCommentToolbarActions', () => {
  // Same revocation, seen from the floating toolbar: the host keeps its config
  // object, so only a memo that re-reads the capability drops the action.
  it('drops the comment action when access is revoked behind an unchanged config', () => {
    const editor = { dispatchCommand: vi.fn() };
    const capabilities = { read: true, comment: true };
    const config: CommentsConfig = {
      ...commentsConfig,
      getCapabilities: () => capabilities,
    };
    const hasCommentAction = (actions: { id: string }[]) =>
      actions.some((action) => action.id === 'comment');

    const { result, rerender } = renderHook(() =>
      useCommentToolbarActions(config, editor),
    );
    expect(hasCommentAction(result.current)).toBe(true);

    const beforeRevocation = result.current;
    rerender();
    // Nothing changed, so the toolbar must not see a new array.
    expect(result.current).toBe(beforeRevocation);

    capabilities.comment = false;
    rerender();
    expect(hasCommentAction(result.current)).toBe(false);
  });
});

