/**
 * The quiet inline appearance of a tracker reference: the item's full title as
 * link text, with a kind-tinted underline (dashed for questions) as the only
 * chrome. Key, kind, state and a one-line summary move to a hover peek.
 *
 * A reader never needs the key in prose, and a sentence listing a dozen pages
 * as bordered pills is unreadable, so hosts whose documents are prose opt into
 * this. It changes presentation only; the node and its markdown are untouched.
 */

import type { CSSProperties, JSX } from 'react';
import { Suspense, createContext, lazy, useCallback, useContext, useEffect, useRef, useState } from 'react';

import type { TrackerItem } from '../../trackers/dataSource';
import { displayKey, openHandlers, text, type ResolverProps } from './TrackerReferenceParts';
import { useTrackerReference } from './TrackerReferenceResolverContext';
import type { TrackerReferenceResolver } from './trackerReferenceResolver';

// The peek pulls in @floating-ui/react; loading it on first hover keeps it out
// of the trackers-ui eager graph that every document pays for.
const Peek = lazy(() => import('./TrackerReferenceQuietPeek').then((module) => ({ default: module.TrackerReferenceQuietPeek })));

/** How an inline (`chip` view) reference renders in prose. */
export type TrackerReferenceInlineAppearance = 'chip' | 'quiet';

export const TrackerReferenceInlineAppearanceContext = createContext<TrackerReferenceInlineAppearance>('chip');

export function useTrackerReferenceInlineAppearance(): TrackerReferenceInlineAppearance {
  return useContext(TrackerReferenceInlineAppearanceContext);
}

const PEEK_OPEN_DELAY_MS = 300;
const PEEK_CLOSE_DELAY_MS = 120;

/** The first sentence of a text, so the peek stays one short line. */
function firstSentence(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  const match = trimmed.match(/^.+?[.!?](?=\s|$)/);
  return match ? match[0] : trimmed;
}

/** What the item is about, in the field its kind keeps it in. */
export function peekSummary(resolver: TrackerReferenceResolver, item: TrackerItem): string | null {
  const value = text(resolver, item, 'summary')
    ?? text(resolver, item, 'scope')
    ?? text(resolver, item, 'position')
    ?? text(resolver, item, 'valueText')
    ?? (item.description?.trim() ? item.description : null);
  return value ? firstSentence(value) : null;
}

/** Open after a hover delay, close after a short grace so the pointer can reach the peek. */
function usePeekOpenState(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const schedule = useCallback((next: boolean, delay: number) => {
    clear();
    timer.current = setTimeout(() => setOpen(next), delay);
  }, [clear]);
  const show = useCallback(() => { if (enabled) schedule(true, PEEK_OPEN_DELAY_MS); }, [enabled, schedule]);
  const showNow = useCallback(() => { if (enabled) { clear(); setOpen(true); } }, [enabled, clear]);
  const hide = useCallback(() => schedule(false, PEEK_CLOSE_DELAY_MS), [schedule]);
  const keep = clear;
  const hideNow = useCallback(() => { clear(); setOpen(false); }, [clear]);
  useEffect(() => clear, [clear]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hideNow(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, hideNow]);
  return { open: open && enabled, show, showNow, hide, keep, hideNow };
}

export function QuietLink({ resolver, referenceKey }: ResolverProps): JSX.Element {
  const resolution = useTrackerReference(resolver, referenceKey);
  const resolved = resolution.state === 'resolved';
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const peek = usePeekOpenState(resolved);

  if (resolution.state !== 'resolved') {
    return (
      <span
        className="tracker-reference-quiet"
        data-issue-key={referenceKey}
        data-resolved="false"
        data-state={resolution.state}
        title={resolution.state === 'loading' ? `${referenceKey} (loading)` : `${referenceKey} (not found)`}
      >
        {referenceKey}
      </span>
    );
  }

  const { item, typeInfo, status } = resolution;
  const done = status?.category === 'done' || status?.category === 'cancelled';
  return (
    <>
      <span
        ref={setAnchor}
        className="tracker-reference-quiet"
        data-issue-key={referenceKey}
        data-resolved="true"
        data-type={item.type}
        data-completed={done ? 'true' : 'false'}
        style={{ '--tracker-reference-kind': typeInfo.color } as CSSProperties}
        {...openHandlers(resolver, item.id)}
        onPointerEnter={peek.show}
        onPointerLeave={peek.hide}
        onFocus={peek.showNow}
        onBlur={peek.hideNow}
      >
        {item.title || displayKey(item, referenceKey)}
      </span>
      {peek.open && anchor ? (
        <Suspense fallback={null}>
          <Peek
            anchor={anchor}
            item={item}
            referenceKey={referenceKey}
            typeInfo={typeInfo}
            status={status}
            summary={peekSummary(resolver, item)}
            onPointerEnter={peek.keep}
            onPointerLeave={peek.hide}
          />
        </Suspense>
      ) : null}
    </>
  );
}
