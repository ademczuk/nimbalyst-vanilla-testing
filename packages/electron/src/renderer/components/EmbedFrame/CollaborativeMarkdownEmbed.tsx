/**
 * A shared *markdown* document, mounted inside an embed.
 *
 * The extension branch of `CollaborativeEmbedEditor` just renders the
 * registration's component and lets the SDK's `useCollaborativeEditor` hook do
 * the binding. Markdown has no registration and no hook: it is the app's own
 * Lexical editor, and its collaborative wiring lives in `CollaborativeTabEditor`
 * as a hand-rolled branch. This is that branch, reduced to what a card needs --
 * no tab header, no diff adapter, no revision rail, no history controller.
 *
 * What could NOT be reduced away, and why (all four are load-bearing; see the
 * header of `CollabLexicalProvider` for the failure history):
 *
 * 1. **`prepareForBinding()` in the provider factory.** Lexical paints only
 *    Y.Doc events observed after its binding attaches. A binding that mounts
 *    onto an already-claimed, already-populated editorDoc renders blank
 *    forever. Rotating the editorDoc per binding is what makes the replay at
 *    `connect()` observable. A card mounts and unmounts constantly -- cold to
 *    warm, warm to hot, scrolled off the board -- so this path runs far more
 *    often here than in a tab.
 * 2. **`deferInitialSync` gated on the replica.** A durable local hit is
 *    immediately bindable; a first open must wait for the server's room-state
 *    response, or CollaborationPlugin bootstraps local content into a room that
 *    already had content and CRDT-merges the two.
 * 3. **`handleStatusChange` right after construction.** The embed cache is
 *    refcounted, so the provider handed over may already be connected. Without
 *    re-publishing its current status the adapter never learns it, and the
 *    catch-up path leaves an empty editor.
 * 4. **`shouldBootstrap: false`, always.** An embed never seeds. The document
 *    exists -- that is the entire premise of pointing a card at it -- and
 *    seeding one that is merely slow to arrive is how content gets duplicated.
 *
 * `key={epoch}` on the editor is the fourth's companion: a replacement provider
 * must get a *fresh* CollaborationPlugin, because a surviving one keeps the
 * destroyed provider alive behind its one-time-init guard.
 *
 * Read-only is subscribed rather than read. `MarkdownEditor` takes `editable`
 * from its config and never consults `host.readOnly`, and the host above
 * deliberately does not re-render when a card warms or cools -- that is what
 * keeps warming from tearing down a live editor and its room. So the flip has
 * to arrive through the listener, or a warm card is quietly editable behind
 * the pointer-inert layer that is only supposed to be a second line of
 * defence.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Doc } from 'yjs';
import type { Provider } from '@lexical/yjs';

import type { EditorHost } from '@nimbalyst/runtime';
import { MarkdownEditor, DocumentPathProvider } from '@nimbalyst/runtime';
import { CollabLexicalProvider } from '@nimbalyst/runtime/collab-lexical';
import { buildCollabUri } from '@nimbalyst/collab-protocol';

import type { CollaborativeEmbedProviderResource } from '../../services/CollaborativeEmbedProviderCache';

interface CollaborativeMarkdownEmbedProps {
  host: EditorHost;
  resource: CollaborativeEmbedProviderResource;
}

export const CollaborativeMarkdownEmbed: React.FC<
  CollaborativeMarkdownEmbedProps
> = ({ host, resource }) => {
  const [readOnly, setReadOnly] = useState(host.readOnly !== false);
  useEffect(() => {
    // `onReadOnlyChanged` invokes the callback immediately with the current
    // value, so there is no window where the initial guess is what is painted.
    const unsubscribe = host.onReadOnlyChanged?.((next) => setReadOnly(next));
    return unsubscribe;
  }, [host]);

  const providerRef = useRef<CollabLexicalProvider | null>(null);
  // 0 means "no provider yet", which gates the first mount. Every later
  // increment forces a fresh CollaborationPlugin onto the new provider.
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const provider = new CollabLexicalProvider(resource.syncProvider, {
      deferInitialSync: !(
        resource.replica.wasHydratedFromStore() &&
        resource.replica.getState() === 'ready'
      ),
    });
    providerRef.current = provider;
    provider.handleStatusChange(resource.syncProvider.getStatus());
    setEpoch((current) => current + 1);
    return () => {
      provider.destroy();
      if (providerRef.current === provider) providerRef.current = null;
    };
  }, [resource]);

  const providerFactory = useCallback(
    (id: string, yjsDocMap: Map<string, Doc>): Provider => {
      const provider = providerRef.current;
      if (!provider) {
        throw new Error(
          '[CollaborativeMarkdownEmbed] CollabLexicalProvider not initialized'
        );
      }
      provider.prepareForBinding();
      yjsDocMap.set(id, provider.getYDoc());
      return provider;
    },
    []
  );

  const config = resource.config;
  const collaborationConfig = useMemo(
    () => ({
      providerFactory,
      // Never. See the header: an embed points at a document that exists.
      shouldBootstrap: false,
      username: config.userName || config.teamMemberId,
    }),
    [providerFactory, config.userName, config.teamMemberId]
  );

  const editorConfig = useMemo(
    () => ({ editable: !readOnly, showToolbar: !readOnly }),
    [readOnly]
  );

  const documentPath = useMemo(
    () => buildCollabUri(config.orgId, config.documentId),
    [config.orgId, config.documentId]
  );

  if (epoch === 0) {
    return (
      <div className="embed-frame__loading" data-testid="collab-markdown-loading">
        Loading shared document...
      </div>
    );
  }

  return (
    <DocumentPathProvider key={epoch} documentPath={documentPath}>
      <MarkdownEditor
        host={host}
        config={editorConfig}
        collaborationConfig={collaborationConfig}
      />
    </DocumentPathProvider>
  );
};
