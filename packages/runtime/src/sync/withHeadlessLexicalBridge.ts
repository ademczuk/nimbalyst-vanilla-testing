/**
 * withHeadlessLexicalBridge
 *
 * Run `fn` against a headless Lexical editor holding `yDoc`'s content, with
 * edits flowing back into `yDoc`.
 *
 * Binds to a FRESH working doc and replays `yDoc`'s state into it, rather than
 * binding to `yDoc` directly. This is the same editor-doc bridge
 * `CollabLexicalProvider` uses in the renderer, and it exists for the same
 * reason (its FAILURE HISTORY note 1, NIM-1764): a binding only builds its
 * collab tree from updates it observes, so binding straight to an
 * already-populated doc yields an EMPTY editor state.
 *
 * That emptiness was silent and destructive: `exportToFile` / `toPlainText`
 * returned '' for every non-empty document, and a `$getRoot().clear()` was a
 * no-op against content the editor had never seen.
 *
 * The NODE SET is the caller's choice and it matters. The main process has no
 * extension graph, so it must pass the minimal `HeadlessBodyNodes` -- with
 * anything less registered, a list- or link-bearing document throws "Node list
 * is not registered" mid-import and leaves the Y.Doc empty. The renderer has
 * the full graph and should pass it, so a headless edit sees exactly what the
 * mounted editor would.
 */
import { applyUpdate, encodeStateAsUpdate, Doc as YDoc } from 'yjs';
import type { Doc } from 'yjs';
import type { Provider } from '@lexical/yjs';
import type { Klass, LexicalNode } from 'lexical';

import { HeadlessLexicalYDoc } from './HeadlessLexicalYDoc';

const NOOP_PROVIDER: Provider = {
  awareness: {
    getLocalState: () => null,
    getStates: () => new Map(),
    setLocalState: () => {},
    setLocalStateField: () => {},
    on: () => {},
    off: () => {},
  },
  connect: () => Promise.resolve(),
  disconnect: () => {},
  on: () => {},
  off: () => {},
} as unknown as Provider;

/** Origin for bridge traffic, so an update is never echoed back to its source. */
const BRIDGE_ORIGIN = Symbol('nimbalyst:headless-lexical-bridge');

export interface HeadlessLexicalBridgeOptions {
  /** Editor node classes. See the node-set note in the module header. */
  nodes: ReadonlyArray<Klass<LexicalNode> | { replace: Klass<LexicalNode>; with: any }>;
  namespace?: string;
  rootId?: string;
}

export function withHeadlessLexicalBridge<T>(
  yDoc: Doc,
  options: HeadlessLexicalBridgeOptions,
  fn: (headless: HeadlessLexicalYDoc) => T,
): T {
  const workDoc = new YDoc();
  const provider: Provider = {
    ...NOOP_PROVIDER,
    getYDoc: () => workDoc,
  } as Provider;
  const headless = new HeadlessLexicalYDoc({
    doc: workDoc,
    nodes: options.nodes,
    provider,
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    ...(options.rootId === undefined ? {} : { rootId: options.rootId }),
  });

  // Step 1: replay the source state so the binding observes it and builds its
  // collab tree. Step 2: materialize that tree into the Lexical editor state.
  // Both are required -- see `hydrateFromYDoc`.
  applyUpdate(workDoc, encodeStateAsUpdate(yDoc), BRIDGE_ORIGIN);
  headless.hydrateFromYDoc();

  const forwardToSource = (update: Uint8Array, origin: unknown) => {
    if (origin === BRIDGE_ORIGIN) return;
    applyUpdate(yDoc, update, BRIDGE_ORIGIN);
  };
  workDoc.on('update', forwardToSource);

  try {
    return fn(headless);
  } finally {
    try { workDoc.off('update', forwardToSource); } catch { /* ignore */ }
    try { headless.destroy(); } catch { /* ignore */ }
    try { workDoc.destroy(); } catch { /* ignore */ }
  }
}
