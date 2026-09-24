/**
 * The state word as a control: click "Proposed" to get the valid next states,
 * what each means, and a footer saying everyone sees the change. Used by the
 * embedded card and by a host's own state line for the page item.
 *
 * It must not take the editor's caret. The trigger and rows cancel mousedown so
 * focus and selection stay in the document; the menu renders in a portal, so
 * its keystrokes never reach the editor; and when a prompt field did take
 * focus, closing hands it back with the editor's previous selection.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, MouseEvent } from 'react';

import type { TrackerItem } from '../../trackers/dataSource';
import { FloatingPortal, useTrackerFloatingMenu } from '../useTrackerFloatingMenu';
import {
  personLabel,
  stateTone,
  stateTransitions,
  todayIso,
  transitionUpdates,
  type StateTransition,
} from './trackerReferenceLifecycle';
import type { TrackerReferenceResolver } from './trackerReferenceResolver';
import './trackerReferenceViews.css';

/**
 * Returns focus to the enclosing editor with its previous selection. Provided
 * by the embedded views, which already load the editor; a context rather than
 * a direct import keeps Lexical out of the tracker surfaces that reuse this
 * menu. Absent means focus goes back to whatever held it before.
 */
export const TrackerStateMenuFocusContext = createContext<(() => void) | null>(null);

/** A committed change, with what it overwrote so the caller can offer Undo. */
export interface TrackerStateChange {
  itemId: string;
  verb: string;
  updates: Record<string, unknown>;
  previous: Record<string, unknown>;
}

/** Called with the updates just before they are written, so a caller can tell its own echo apart. */
export type TrackerPendingWrite = (updates: Record<string, unknown>) => void;

/**
 * The current values of the fields `updates` would overwrite. A field the item
 * does not have is recorded as `undefined`, not `null`: writing it back leaves
 * the key out of the JSON-encoded payload, so Undo restores absence exactly.
 */
export function previousValues(
  resolver: TrackerReferenceResolver,
  item: TrackerItem,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(updates)) {
    previous[key] = key === 'status' ? item.status : resolver.fieldValue(item, key);
  }
  return previous;
}

/** Write a set of updates and report the change. Throws when the write fails. */
export async function commitTrackerUpdates(
  resolver: TrackerReferenceResolver,
  item: TrackerItem,
  updates: Record<string, unknown>,
  verb: string,
  onPending?: TrackerPendingWrite,
): Promise<TrackerStateChange> {
  if (!resolver.updateItem) throw new Error('This item is read-only here');
  const previous = previousValues(resolver, item, updates);
  onPending?.(updates);
  await resolver.updateItem(item.id, updates);
  return { itemId: item.id, verb, updates, previous };
}

/** Run a menu transition (also what Apply on an agent proposal runs). */
export function runStateTransition(
  resolver: TrackerReferenceResolver,
  item: TrackerItem,
  transition: StateTransition,
  options: { input?: string; extra?: Record<string, unknown>; onPending?: TrackerPendingWrite } = {},
): Promise<TrackerStateChange> {
  const updates = {
    ...transitionUpdates(transition, {
      actor: resolver.currentActor?.() ?? null,
      today: todayIso(),
      input: options.input,
    }),
    ...options.extra,
  };
  return commitTrackerUpdates(resolver, item, updates, transition.verb, options.onPending);
}

/** The menu rows for an item, from its type's statuses and current fields. */
export function useStateTransitions(resolver: TrackerReferenceResolver, item: TrackerItem): StateTransition[] {
  const position = resolver.fieldValue(item, 'position');
  const positionState = resolver.fieldValue(item, 'positionState');
  const owner = resolver.fieldValue(item, 'owner') ?? item.owner;
  return useMemo(() => stateTransitions({
    type: item.type,
    status: item.status ?? null,
    statusOptions: resolver.statusOptions?.(item.type) ?? [],
    position: typeof position === 'string' ? position : null,
    positionState: typeof positionState === 'string' ? positionState : null,
    positionOwnerName: personLabel(resolver, owner),
    canOpenItem: Boolean(resolver.openItem),
  }), [item.type, item.status, owner, position, positionState, resolver]);
}

/** Opens the menu on one transition's prompt, prefilled (Apply on an agent proposal). */
export interface TrackerStateMenuRequest {
  transitionId: string;
  input: string;
  /** Written alongside the transition's own updates, e.g. clearing the proposal. */
  extra?: Record<string, unknown>;
}

export interface TrackerStateMenuProps {
  resolver: TrackerReferenceResolver;
  item: TrackerItem;
  /** Called after a change commits, e.g. to show "You accepted just now · Undo". */
  onChanged?: (change: TrackerStateChange) => void;
  onPending?: TrackerPendingWrite;
  request?: TrackerStateMenuRequest | null;
  onRequestHandled?: () => void;
  /** Forces the plain word even when the resolver can write. */
  readOnly?: boolean;
  className?: string;
}

const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * The state word. A button with a chevron when the resolver can write the
 * item; plain colored text when it cannot.
 */
export function TrackerStateMenu({
  resolver,
  item,
  onChanged,
  onPending,
  request,
  onRequestHandled,
  readOnly,
  className,
}: TrackerStateMenuProps): JSX.Element | null {
  const status = resolver.statusInfo(item);
  const transitions = useStateTransitions(resolver, item);
  const restoreEditorFocus = useContext(TrackerStateMenuFocusContext);
  const [prompt, setPrompt] = useState<StateTransition | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priorFocus = useRef<HTMLElement | null>(null);
  const promptHadFocus = useRef(false);
  const extra = useRef<Record<string, unknown> | undefined>(undefined);

  const menu = useTrackerFloatingMenu({ placement: 'bottom-start' });
  const { isOpen, setIsOpen } = menu;

  // Closing after a prompt field took focus gives it back to the document.
  useEffect(() => {
    if (isOpen) return;
    setPrompt(null);
    setInput('');
    setError(null);
    extra.current = undefined;
    if (!promptHadFocus.current) return;
    promptHadFocus.current = false;
    if (restoreEditorFocus) restoreEditorFocus();
    else priorFocus.current?.focus({ preventScroll: true });
  }, [isOpen, restoreEditorFocus]);

  useEffect(() => {
    if (!request) return;
    const transition = transitions.find((entry) => entry.id === request.transitionId);
    onRequestHandled?.();
    if (!transition) return;
    priorFocus.current = document.activeElement as HTMLElement | null;
    setIsOpen(true);
    setPrompt(transition);
    setInput(request.input);
    extra.current = request.extra;
  }, [onRequestHandled, request, setIsOpen, transitions]);

  const commit = useCallback(async (transition: StateTransition, value?: string) => {
    if (transition.opensItem) {
      setIsOpen(false);
      resolver.openItem?.(item.id);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const change = await runStateTransition(resolver, item, transition, { input: value, extra: extra.current, onPending });
      setIsOpen(false);
      onChanged?.(change);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [item, onChanged, onPending, resolver, setIsOpen]);

  if (!status) return null;
  const tone = stateTone(item.type, status);
  const editable = !readOnly && Boolean(resolver.updateItem) && transitions.length > 0;
  const wordClass = `tracker-state-word${className ? ` ${className}` : ''}`;
  if (!editable) {
    return <span className={wordClass} data-tone={tone} data-status={status.value}>{status.label}</span>;
  }

  // A replacement is a key; it commits only once it names another existing item.
  let value: string | null = input.trim() || null;
  let hint: string | null = null;
  if (prompt?.prompt?.field === 'supersededBy' && value) {
    const target = resolver.resolve(value);
    value = target.state === 'resolved' && target.item.id !== item.id ? target.item.id : null;
    if (!value) hint = target.state === 'loading' ? 'Looking it up...' : `No other item ${input.trim()}`;
  }

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && prompt && value) {
      event.preventDefault();
      void commit(prompt, value);
    }
  };

  return (
    <>
      <button
        type="button"
        ref={menu.refs.setReference}
        className={wordClass}
        data-tone={tone}
        data-status={status.value}
        data-open={isOpen ? 'true' : 'false'}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        {...menu.getReferenceProps()}
        onMouseDown={keepFocus}
        onClick={() => {
          priorFocus.current = document.activeElement as HTMLElement | null;
          setIsOpen(!isOpen);
        }}
      >
        {status.label}
        <span className="tracker-state-word-chevron" aria-hidden="true" />
      </button>
      {isOpen ? (
        <FloatingPortal>
          <div
            ref={menu.refs.setFloating}
            style={menu.floatingStyles}
            className="tracker-state-menu"
            {...menu.getFloatingProps()}
            onMouseDown={(event) => {
              if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault();
            }}
          >
            {transitions.map((transition) => (
              <div key={transition.id} className="tracker-state-menu-entry">
                {transition.separatorBefore ? <div className="tracker-state-menu-rule" aria-hidden="true" /> : null}
                <button
                  type="button"
                  role="menuitem"
                  className="tracker-state-menu-row"
                  data-active={prompt?.id === transition.id ? 'true' : 'false'}
                  disabled={busy}
                  onClick={() => {
                    if (transition.prompt) {
                      setPrompt(transition);
                      setInput('');
                      return;
                    }
                    void commit(transition);
                  }}
                >
                  <span className="tracker-state-menu-label" data-tone={transition.opensItem ? undefined : transition.tone}>
                    {transition.label}
                  </span>
                  {transition.description ? (
                    <span className="tracker-state-menu-description">{transition.description}</span>
                  ) : null}
                </button>
                {prompt?.id === transition.id && transition.prompt ? (
                  <div className="tracker-state-menu-prompt">
                    <label className="tracker-state-menu-description" htmlFor={`tracker-state-prompt-${item.id}`}>
                      {transition.prompt.label}
                    </label>
                    <textarea
                      id={`tracker-state-prompt-${item.id}`}
                      className="tracker-state-menu-input"
                      rows={transition.prompt.field === 'supersededBy' ? 1 : 2}
                      autoFocus
                      value={input}
                      placeholder={transition.prompt.placeholder}
                      onFocus={() => { promptHadFocus.current = true; }}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={onPromptKeyDown}
                    />
                    {hint ? <span className="tracker-state-menu-description">{hint}</span> : null}
                    <div className="tracker-state-menu-actions">
                      <button type="button" className="tracker-state-menu-button" onClick={() => setPrompt(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="tracker-state-menu-button"
                        data-primary="true"
                        disabled={busy || !value}
                        onClick={() => void commit(transition, value!)}
                      >
                        {transition.prompt.confirmLabel}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            {error ? <div className="tracker-state-menu-error" role="alert">{error}</div> : null}
            <div className="tracker-state-menu-footer">
              Changes {item.issueKey ?? item.title} for everyone.
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
