/**
 * TrackerReferenceNode — an inline reference (pointer) to a tracker item.
 *
 * Unlike `TrackerItemNode` (which embeds a frozen snapshot of an item inline),
 * this node stores ONLY the reference key (e.g. `NIM-123`). The decorated chip
 * resolves the item's title/status *live* at render time via the injected
 * {@link TrackerReferenceResolver}, so editing or closing the item elsewhere
 * updates every chip pointing at it with no document edit.
 *
 * Serializes to a portable markdown link `[NIM-123](nimbalyst://NIM-123)` via
 * {@link TrackerReferenceTransformer}, so the document stays valid markdown and
 * degrades to a plain link in any other viewer.
 */

import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from 'lexical';
import type { JSX } from 'react';

import { $applyNodeReplacement, DecoratorNode } from 'lexical';
import * as React from 'react';

import { getTrackerReferenceNodeRenderer } from './TrackerReferenceNodeRenderer';

export const TRACKER_REFERENCE_URN_SCHEME = 'nimbalyst://';

export type TrackerReferenceView = 'chip' | 'card' | 'statements';

export function normalizeTrackerReferenceView(view: unknown): TrackerReferenceView {
  return view === 'card' || view === 'statements' ? view : 'chip';
}

export type SerializedTrackerReferenceNode = Spread<
  {
    /** Reference key: an issue key (NIM-123) or local short id (tk_abc123). */
    referenceKey: string;
    view?: TrackerReferenceView;
  },
  SerializedLexicalNode
>;

function convertTrackerReferenceElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  const referenceKey = domNode.getAttribute('data-issue-key');
  if (referenceKey) {
    return { node: $createTrackerReferenceNode(referenceKey, normalizeTrackerReferenceView(domNode.getAttribute('data-view'))) };
  }
  return null;
}

export class TrackerReferenceNode extends DecoratorNode<JSX.Element> {
  __referenceKey: string;
  __view: TrackerReferenceView;

  static getType(): string {
    return 'tracker-reference';
  }

  static clone(node: TrackerReferenceNode): TrackerReferenceNode {
    return new TrackerReferenceNode(node.__referenceKey, node.__key, node.__view);
  }

  static importJSON(
    serializedNode: SerializedTrackerReferenceNode,
  ): TrackerReferenceNode {
    return $createTrackerReferenceNode(serializedNode.referenceKey, normalizeTrackerReferenceView(serializedNode.view));
  }

  constructor(referenceKey: string, key?: NodeKey, view: TrackerReferenceView = 'chip') {
    super(key);
    this.__referenceKey = referenceKey;
    this.__view = view;
  }

  exportJSON(): SerializedTrackerReferenceNode {
    return {
      ...super.exportJSON(),
      type: 'tracker-reference',
      version: 1,
      referenceKey: this.__referenceKey,
      ...(this.getView() === 'chip' ? {} : { view: this.getView() }),
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.className = 'tracker-reference';
    const theme = config.theme as { trackerReference?: string };
    if (theme.trackerReference) {
      span.className = `tracker-reference ${theme.trackerReference}`;
    }
    if (this.getView() !== 'chip') {
      span.classList.add(`tracker-reference--${this.getView()}`);
    }
    span.setAttribute('data-issue-key', this.__referenceKey);
    return span;
  }

  updateDOM(prev: TrackerReferenceNode): boolean {
    return prev.__view !== this.__view;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('span');
    element.className = 'tracker-reference';
    element.setAttribute('data-lexical-tracker-reference', 'true');
    element.setAttribute('data-issue-key', this.__referenceKey);
    if (this.getView() !== 'chip') {
      element.setAttribute('data-view', this.getView());
    }
    element.textContent = this.__referenceKey;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-tracker-reference')) {
          return null;
        }
        return { conversion: convertTrackerReferenceElement, priority: 1 };
      },
    };
  }

  decorate(): JSX.Element {
    const Renderer = getTrackerReferenceNodeRenderer();
    if (!Renderer) {
      return (
        <span
          className="tracker-reference"
          data-issue-key={this.__referenceKey}
        >
          {this.__referenceKey}
        </span>
      );
    }
    return (
      <Renderer
        referenceKey={this.__referenceKey}
        nodeKey={this.getKey()}
        view={this.getView()}
      />
    );
  }

  isInline(): true {
    return true;
  }

  /** Plain-text fallback (copy, non-rich serialization) is the bare key. */
  getTextContent(): string {
    return this.__referenceKey;
  }

  getReferenceKey(): string {
    return this.__referenceKey;
  }

  getView(): TrackerReferenceView {
    return normalizeTrackerReferenceView(this.getLatest().__view);
  }

  setView(view: TrackerReferenceView): this {
    const writable = this.getWritable();
    writable.__view = view;
    return writable;
  }
}

export function $createTrackerReferenceNode(
  referenceKey: string,
  view: TrackerReferenceView = 'chip',
): TrackerReferenceNode {
  return $applyNodeReplacement(new TrackerReferenceNode(referenceKey, undefined, view));
}

export function $isTrackerReferenceNode(
  node: LexicalNode | null | undefined,
): node is TrackerReferenceNode {
  return node instanceof TrackerReferenceNode;
}
