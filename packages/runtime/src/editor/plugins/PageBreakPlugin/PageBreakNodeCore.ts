/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/**
 * React-free `PageBreakNode`. `./PageBreakNode/index.tsx` registers the React
 * decorator (and the node's CSS) and re-exports this module; headless graphs
 * (collab worker, CLI) import this one directly. See `nodeDecoratorSlot.ts`.
 */

import type {JSX} from 'react';

import {
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  DOMConversionMap,
  DOMConversionOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  SerializedLexicalNode,
} from 'lexical';

import {createNodeDecoratorSlot} from '../../nodes/nodeDecoratorSlot';

export type SerializedPageBreakNode = SerializedLexicalNode;

export const PageBreakNodeDecorator = createNodeDecoratorSlot<PageBreakNode>();

export class PageBreakNode extends DecoratorNode<JSX.Element | null> {
  static getType(): string {
    return 'page-break';
  }

  static clone(node: PageBreakNode): PageBreakNode {
    return new PageBreakNode(node.__key);
  }

  static importJSON(serializedNode: SerializedPageBreakNode): PageBreakNode {
    return $createPageBreakNode().updateFromJSON(serializedNode);
  }

  static importDOM(): DOMConversionMap | null {
    return {
      figure: (domNode: HTMLElement) => {
        const tp = domNode.getAttribute('type');
        if (tp !== this.getType()) {
          return null;
        }

        return {
          conversion: $convertPageBreakElement,
          priority: COMMAND_PRIORITY_HIGH,
        };
      },
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement('figure');
    el.style.pageBreakAfter = 'always';
    el.setAttribute('type', this.getType());
    return el;
  }

  getTextContent(): string {
    return '\n';
  }

  isInline(): false {
    return false;
  }

  updateDOM(): boolean {
    return false;
  }

  decorate(editor: LexicalEditor, config: EditorConfig): JSX.Element | null {
    return PageBreakNodeDecorator.decorate(this, editor, config);
  }
}

function $convertPageBreakElement(): DOMConversionOutput {
  return {node: $createPageBreakNode()};
}

export function $createPageBreakNode(): PageBreakNode {
  return new PageBreakNode();
}

export function $isPageBreakNode(
  node: LexicalNode | null | undefined,
): node is PageBreakNode {
  return node instanceof PageBreakNode;
}
