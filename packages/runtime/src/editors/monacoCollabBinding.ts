/**
 * createMonacoCollabBinding
 *
 * Reusable live binding between a Monaco editor model and a Yjs `Y.Text`,
 * built on `y-monaco`'s `MonacoBinding`. Any Monaco-based custom editor
 * (calc-sheets, future code/source editors) can become collaborative by:
 *
 *   1. registering a text adapter (`createTextCollabContentAdapter` from
 *      `@nimbalyst/extension-sdk`) for the SAME `Y.Text` field, and
 *   2. calling this from `useCollaborativeEditor`'s `createBinding` once the
 *      editor instance is mounted.
 *
 * `MonacoBinding` reconciles Monaco's model edits with the shared `Y.Text`
 * (character-level CRDT merge) and renders remote selections via the optional
 * `awareness`. The returned handle's `destroy()` detaches everything; call it
 * from the binding teardown so observers and awareness listeners are cleaned
 * up on unmount.
 */
import { MonacoBinding } from 'y-monaco';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { editor as MonacoEditorNamespace } from 'monaco-editor';

export interface MonacoCollabBindingOptions {
  /** The shared text field to bind. Must be the SAME field the document's
   *  CollabContentAdapter reads/writes (default 'content'). */
  yText: Y.Text;
  /** The mounted Monaco editor instance (e.g. the `editor` on the wrapper
   *  passed to MonacoEditor's `onEditorReady`). */
  editor: MonacoEditorNamespace.IStandaloneCodeEditor;
  /** Optional collaboration awareness for remote cursors/selections. */
  awareness?: Awareness | null;
}

export interface MonacoCollabBindingHandle {
  destroy(): void;
}

/**
 * Wrap an awareness so its `change` listeners run on a microtask instead of
 * synchronously.
 *
 * `MonacoBinding` calls `awareness.setLocalStateField('selection', ...)` from
 * Monaco's cursor-selection event, and awareness emits `change` synchronously,
 * so y-monaco's remote-cursor repaint (`deltaDecorations`) lands inside
 * whatever decoration change produced that selection event -- Monaco's own
 * WordHighlighter clearing its decorations is the usual one. Monaco reports the
 * nested call through `onUnexpectedError` ("Invoking deltaDecorations
 * recursively could lead to leaking decorations"), which reaches the user as an
 * uncaught error even though the decorations still apply. Deferring the repaint
 * takes it out of that window; remote cursors are a frame later, which is
 * imperceptible.
 *
 * Only `change` is deferred. Everything else -- `getStates`, `setLocalStateField`,
 * other events -- passes straight through, bound to the real awareness so no
 * internal `this` ever sees the wrapper.
 */
function deferAwarenessChangeEvents(awareness: Awareness): {
  awareness: Awareness;
  cancelPending: () => void;
} {
  const deferredByOriginal = new Map<AwarenessListener, AwarenessListener>();
  let cancelled = false;

  const wrapListener = (listener: AwarenessListener): AwarenessListener => {
    const existing = deferredByOriginal.get(listener);
    if (existing) return existing;
    const deferred: AwarenessListener = (...args: unknown[]) => {
      queueMicrotask(() => {
        if (cancelled) return;
        listener(...args);
      });
    };
    deferredByOriginal.set(listener, deferred);
    return deferred;
  };

  const wrapped = new Proxy(awareness, {
    get(target, prop) {
      if (prop === 'on' || prop === 'off' || prop === 'once') {
        const method = (
          target as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>
        )[prop];
        // Awareness always defines all three, so this only ever takes the
        // `function` branch. The check is what makes that provable under
        // `noUncheckedIndexedAccess`; falling through to the generic path below
        // is the same thing the proxy would do for any other property.
        if (typeof method === 'function') {
          return (eventName: string, listener: AwarenessListener) => {
            const effective = eventName === 'change' ? wrapListener(listener) : listener;
            return method.call(target, eventName, effective);
          };
        }
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return {
    awareness: wrapped,
    cancelPending: () => {
      cancelled = true;
    },
  };
}

type AwarenessListener = (...args: any[]) => void;

export function createMonacoCollabBinding({
  yText,
  editor,
  awareness,
}: MonacoCollabBindingOptions): MonacoCollabBindingHandle {
  const model = editor.getModel();
  if (!model) {
    throw new Error('createMonacoCollabBinding: the Monaco editor has no text model');
  }

  const deferred = awareness ? deferAwarenessChangeEvents(awareness) : null;

  const binding = new MonacoBinding(
    yText,
    model,
    new Set([editor]),
    deferred?.awareness ?? null,
  );

  return {
    destroy() {
      // Drop any repaint still queued for an editor that is about to go away.
      deferred?.cancelPending();
      binding.destroy();
    },
  };
}
