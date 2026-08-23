/**
 * "Blocked by N" on a tracker row, with the reason one hover away.
 *
 * A count on its own tells someone they cannot start the item but not what to
 * do about it, so the card names each open blocker and the state it is in. The
 * refs come from `BlockerRef.ref` -- resolved by the readiness model -- because
 * an item that has never been shared has only a dotted number local to this
 * machine, and that number means nothing to anyone else.
 *
 * A blocker sitting outside the view's own type or archive scope is named only
 * by its type and state. That rule lives in `trackerBlockerVisibility` and is
 * shared with the agent-tool projection, so the two surfaces cannot drift into
 * disagreeing about what a filtered-out item is allowed to disclose.
 */

import React from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { MaterialSymbol } from '../../../ui/icons/MaterialSymbol';
import { windowControlsClearance } from '../../../ui/floating/windowControlsClearance';
import type { Readiness } from '../models/trackerReadiness';
import {
  TRACKER_DEPENDENCY_CYCLE_MESSAGE,
  TRACKER_LOCAL_ISSUE_KEY_BRIEF_MESSAGE,
} from '../models/trackerLifecycle';
import {
  describeUnresolvedBlockers,
  isOutOfScopeBlocker,
  projectBlockedBy,
  type BlockerVisibilityScope,
} from '../models/trackerBlockerVisibility';

/**
 * Nothing renders for an item with neither an open blocker nor a broken link:
 * an always-present "0 blockers" chip would be noise on every row.
 *
 * An item whose only dependency problem is a dangling target is NOT blocked, so
 * it gets a quieter, differently-shaped affordance rather than the warning chip
 * -- the link is broken, but the work can start.
 */
export const TrackerBlockedChip: React.FC<{
  readiness: Readiness | undefined;
  /** The view's own scope; an empty scope spans everything and redacts nothing. */
  scope?: BlockerVisibilityScope;
  className?: string;
}> = ({ readiness, scope, className = '' }) => {
  const [open, setOpen] = React.useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    middleware: [
      offset(6),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      windowControlsClearance(),
    ],
    // The row scrolls under the card, so the card has to follow it.
    whileElementsMounted: autoUpdate,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, { move: false, delay: { open: 120, close: 80 } }),
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: 'tooltip' }),
  ]);

  const blockers = projectBlockedBy(readiness?.blockedBy ?? [], scope ?? {});
  const unresolvedCount = readiness?.unresolvedBlockerIds.length ?? 0;
  if (blockers.length === 0 && unresolvedCount === 0) return null;

  if (blockers.length === 0) {
    return (
      <>
        <span
          ref={refs.setReference}
          {...getReferenceProps()}
          tabIndex={0}
          className={`tracker-broken-link-chip inline-flex shrink-0 items-center rounded-[10px] px-[5px] py-[2px] text-[var(--nim-text-faint)] ${className}`}
          data-testid="tracker-broken-link-chip"
          data-unresolved-count={unresolvedCount}
          aria-label={describeUnresolvedBlockers(unresolvedCount)}
        >
          <MaterialSymbol icon="link_off" size={11} />
        </span>
        {open && (
          <FloatingPortal>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className="tracker-broken-link-chip-card z-50 w-[240px] select-text rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-2.5 text-[11px] text-[var(--nim-text-muted)] shadow-lg"
            >
              {describeUnresolvedBlockers(unresolvedCount)}
            </div>
          </FloatingPortal>
        )}
      </>
    );
  }

  // Only a ref the caller can actually see earns the private-number caveat; a
  // redacted blocker carries no ref at all.
  const hasLocalRef = blockers.some(
    (blocker) => !isOutOfScopeBlocker(blocker) && blocker.refStatus === 'local',
  );

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps()}
        tabIndex={0}
        className={`tracker-blocked-chip inline-flex shrink-0 items-center gap-1 rounded-[10px] bg-[var(--nim-bg-tertiary)] px-[7px] py-[2px] text-[10px] font-semibold text-[var(--nim-warning)] ${className}`}
        data-testid="tracker-blocked-chip"
        data-blocker-count={blockers.length}
        aria-label={`Blocked by ${blockers.length} ${blockers.length === 1 ? 'item' : 'items'}`}
      >
        <MaterialSymbol icon="block" size={11} />
        {blockers.length}
      </span>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="tracker-blocked-chip-card z-50 w-[280px] select-text rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-2.5 text-[11px] text-[var(--nim-text-muted)] shadow-lg"
          >
            <div className="mb-1.5 font-semibold text-[var(--nim-text)]">
              Blocked by {blockers.length} {blockers.length === 1 ? 'item' : 'items'}
            </div>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {blockers.map((blocker) => (
                <li key={blocker.itemId} className="flex items-baseline gap-1.5">
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--nim-text-faint)]">
                    {isOutOfScopeBlocker(blocker) ? '--' : blocker.ref}
                  </span>
                  <span
                    className={isOutOfScopeBlocker(blocker)
                      ? 'min-w-0 flex-1 truncate italic text-[var(--nim-text-muted)]'
                      : 'min-w-0 flex-1 truncate text-[var(--nim-text)]'}
                  >
                    {isOutOfScopeBlocker(blocker)
                      ? `A ${blocker.type} outside this view`
                      : blocker.title ?? 'Untitled'}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--nim-text-faint)]">
                    {blocker.status}
                  </span>
                </li>
              ))}
            </ul>
            {readiness?.inCycle && (
              <div className="mt-2 border-t border-[var(--nim-border)] pt-1.5">
                {TRACKER_DEPENDENCY_CYCLE_MESSAGE}
              </div>
            )}
            {unresolvedCount > 0 && (
              <div className="mt-2 border-t border-[var(--nim-border)] pt-1.5">
                {describeUnresolvedBlockers(unresolvedCount)}
              </div>
            )}
            {hasLocalRef && (
              <div className="mt-2 border-t border-[var(--nim-border)] pt-1.5 text-[var(--nim-text-faint)]">
                {TRACKER_LOCAL_ISSUE_KEY_BRIEF_MESSAGE}
              </div>
            )}
          </div>
        </FloatingPortal>
      )}
    </>
  );
};
