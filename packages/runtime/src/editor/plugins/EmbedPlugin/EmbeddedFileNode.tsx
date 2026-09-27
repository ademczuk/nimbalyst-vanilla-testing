/**
 * EmbeddedFileNode -- attaches the editor's React decorator to the React-free
 * class in `./EmbeddedFileNodeCore.ts` and re-exports it.
 */

import type { JSX } from 'react';
import type { NodeKey } from 'lexical';
import React from 'react';

import { getEmbedPluginCallbacks } from './EmbedPluginCallbacks';
import { EmbeddedFileNodeDecorator, type EmbedAttrs } from './EmbeddedFileNodeCore';

EmbeddedFileNodeDecorator.set((node) => (
  <EmbedFrameSlot
    src={node.__src}
    label={node.__label}
    attrs={node.__attrs}
    nodeKey={node.__key}
  />
));

/**
 * Thin wrapper component. Reads the renderer-side EmbedFrame implementation
 * (registered via `setEmbedPluginCallbacks`) at render time and dispatches
 * to it. When no renderer is registered (e.g. on mobile or the share viewer
 * before Phase 6 lands), it shows a chrome-only placeholder so the host doc
 * still renders.
 */
function EmbedFrameSlot(props: {
  src: string;
  label: string;
  attrs: EmbedAttrs;
  nodeKey: NodeKey;
}): JSX.Element {
  const callbacks = getEmbedPluginCallbacks();
  const Renderer = callbacks.renderEmbed;
  if (Renderer) {
    return (
      <Renderer
        src={props.src}
        label={props.label}
        attrs={props.attrs}
        nodeKey={props.nodeKey}
      />
    );
  }
  return <EmbedPlaceholder src={props.src} label={props.label} />;
}

function EmbedPlaceholder(props: { src: string; label: string }): JSX.Element {
  return (
    <div className="embedded-file-placeholder" data-testid="embed-frame-placeholder">
      <span className="embedded-file-placeholder__label">
        {props.label || props.src}
      </span>
      <span className="embedded-file-placeholder__path">{props.src}</span>
    </div>
  );
}

export * from './EmbeddedFileNodeCore';
