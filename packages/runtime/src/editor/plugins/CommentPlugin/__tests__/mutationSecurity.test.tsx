import { act, fireEvent, render, waitFor } from '@testing-library/react';
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
import { Doc } from 'yjs';

import {
  createComment,
  createThread,
  YDocCommentRepository,
} from '../../../commenting/YDocCommentRepository';
import { COMMENT_BOUNDS } from '../../../commenting/commentValidation';
import type { CommentsConfig } from '../../../commenting/types';
import { INSERT_INLINE_COMMENT_COMMAND } from '../../../extensions/builtin/CommentsExtension';
import CommentsPlugin from '../index';
import { OPEN_COMMENT_COMPOSER_COMMAND } from '../commands';

function TestEditorBridge({
  onReady,
  onInsertInlineComment,
}: {
  onReady(editor: LexicalEditor): void;
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

function seedThread(yDoc: Doc): void {
  const repository = new YDocCommentRepository(yDoc);
  repository.addThread(
    createThread(
      'Selected text',
      [
        createComment('Existing review', 'Reviewer', {
          actor: {
            kind: 'user',
            userId: 'reviewer-1',
            displayName: 'Reviewer',
          },
          id: 'comment-1',
          timeStamp: 1,
        }),
      ],
      'thread-1',
      false,
      { kind: 'text-quote', exact: 'Selected text' },
    ),
  );
  repository.destroy();
}

function readThread(yDoc: Doc) {
  const repository = new YDocCommentRepository(yDoc);
  const thread = repository.getSnapshot()[0];
  repository.destroy();
  if (!thread || thread.type !== 'thread') {
    throw new Error('Expected the seeded thread.');
  }
  return thread;
}

function mountPlugin(input: {
  yDoc: Doc;
  capabilities?: { read: boolean; comment: boolean };
  hydrated?: () => boolean;
  onInsertInlineComment?: () => void;
}) {
  const pane = document.createElement('div');
  const anchor = document.createElement('div');
  pane.append(anchor);
  document.body.append(pane);
  const config: CommentsConfig = {
    getYDoc: () => input.yDoc,
    currentUser: { id: 'user-1', name: 'Test User' },
    getCapabilities: input.capabilities ? () => input.capabilities! : undefined,
    isHydrated: input.hydrated,
    getMembers: () => [],
    documentTitle: 'Shared document',
    documentId: 'doc-1',
    documentUri: 'collab://org:test:doc:doc-1',
  };
  let editor: LexicalEditor | undefined;
  const view = render(
    <LexicalComposer
      initialConfig={{
        namespace: `comments-mutation-security-${Math.random()}`,
        nodes: [MarkNode],
        theme: {},
        onError: (error) => {
          throw error;
        },
      }}
    >
      <TestEditorBridge
        onReady={(value) => (editor = value)}
        onInsertInlineComment={input.onInsertInlineComment}
      />
      <CommentsPlugin config={config} anchorElem={anchor} />
    </LexicalComposer>,
  );
  if (!editor) throw new Error('Editor did not initialize.');
  return { editor, pane, unmount: view.unmount };
}

function openPanel(pane: HTMLElement): void {
  const toggle = pane.querySelector<HTMLButtonElement>('.nim-comments-toggle');
  if (!toggle) throw new Error('Comments toggle has not mounted.');
  fireEvent.click(toggle);
}

describe('mounted Markdown comment mutation security', () => {
  const panes: HTMLElement[] = [];

  afterEach(() => {
    for (const pane of panes.splice(0)) pane.remove();
  });

  it('rejects an encoded over-limit reply before it reaches the shared Y.Doc', async () => {
    const yDoc = new Doc();
    seedThread(yDoc);
    const mounted = mountPlugin({ yDoc });
    panes.push(mounted.pane);
    openPanel(mounted.pane);

    const field = await waitFor(() => {
      const element = mounted.pane.querySelector<HTMLTextAreaElement>(
        '.nim-comment-composer-input',
      );
      if (!element) throw new Error('Reply composer has not mounted.');
      return element;
    });
    fireEvent.change(field, {
      target: { value: 'x'.repeat(COMMENT_BOUNDS.maxBodyBytes + 1) },
    });
    const submit = mounted.pane.querySelector<HTMLButtonElement>(
      '.nim-comment-btn-submit',
    );
    if (!submit) throw new Error('Reply submit control has not mounted.');
    fireEvent.click(submit);

    expect(readThread(yDoc).comments).toHaveLength(1);
    mounted.unmount();
  });

  it('blocks resolve and delete when capability is revoked after render', async () => {
    const yDoc = new Doc();
    seedThread(yDoc);
    const capabilities = { read: true, comment: true };
    const mounted = mountPlugin({ yDoc, capabilities });
    panes.push(mounted.pane);
    openPanel(mounted.pane);

    const controls = await waitFor(() => {
      const resolve = mounted.pane.querySelector<HTMLButtonElement>(
        '.nim-comment-btn-resolve',
      );
      const remove = mounted.pane.querySelector<HTMLButtonElement>(
        '.nim-comment-btn-delete-thread',
      );
      if (!resolve || !remove) {
        throw new Error('Thread mutation controls have not mounted.');
      }
      return { resolve, remove };
    });

    capabilities.comment = false;
    fireEvent.click(controls.resolve);
    fireEvent.click(controls.remove);

    expect(readThread(yDoc)).toMatchObject({
      id: 'thread-1',
      resolved: false,
      comments: [{ id: 'comment-1' }],
    });
    mounted.unmount();
  });

  it('does not create a thread before the mounted document hydrates', async () => {
    const yDoc = new Doc();
    const onInsertInlineComment = vi.fn();
    const mounted = mountPlugin({
      yDoc,
      hydrated: () => false,
      onInsertInlineComment,
    });
    panes.push(mounted.pane);

    await act(async () => {
      mounted.editor.update(
        () => {
          const text = $createTextNode('Selected text');
          $getRoot().append($createParagraphNode().append(text));
          text.select(0, text.getTextContentSize());
        },
        { discrete: true },
      );
      mounted.editor.dispatchCommand(OPEN_COMMENT_COMPOSER_COMMAND, undefined);
    });

    expect(yDoc.getArray('comments').length).toBe(0);
    expect(onInsertInlineComment).not.toHaveBeenCalled();
    mounted.unmount();
  });
});
