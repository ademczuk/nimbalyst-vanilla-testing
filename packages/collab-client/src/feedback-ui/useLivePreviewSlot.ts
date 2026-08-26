/**
 * Decides whether one preview is allowed to mount a live editor right now.
 *
 * `EmbedFrame` says in its own header that it has neither visibility gating nor
 * a mount cap -- "Phase 1: always mount the extension". That is defensible for
 * a document with a couple of embeds in it. It is not defensible here: a
 * three-option request mounts three collaborative editors, inside an Inbox pane
 * that may be scrolled past entirely, and a recipient with several requests
 * open would pay for every one of them at once.
 *
 * Two gates, and they are different in kind:
 *
 * - **Visibility** is per-preview and reversible in principle; a preview
 *   scrolled out of view was never worth mounting.
 * - **The cap** is global and deliberately sticky. Once a preview has a slot it
 *   keeps it for its lifetime rather than yielding to whatever scrolled into
 *   view next, because a cap that reshuffles turns scrolling into a mount storm
 *   -- the exact cost it exists to prevent.
 *
 * ## The one exception to stickiness
 *
 * A **priority** claimant may take a slot from a non-priority one. That is the
 * detail popover, and only the detail popover: it is the artifact the user is
 * actually looking at, full-size and alone on screen, so it outranks any card
 * or column behind it.
 *
 * This does not reopen the mount-storm problem the stickiness rule exists to
 * prevent, because that rule is about *scrolling*. Scrolling is continuous and
 * unintentional; opening a popover is a deliberate, discrete act that happens
 * once. Non-priority claimants still never evict each other.
 */

import { useEffect, useRef, useState } from 'react';

/**
 * Enough for the "pick one of these three" case with headroom, low enough that
 * a long list of requests cannot mount editors without bound.
 */
export const MAX_CONCURRENT_LIVE_PREVIEWS = 4;

interface LivePreviewClaim {
  priority: boolean;
  /** Drops this claimant back to gated. Called by an evicting priority claim. */
  yieldSlot(): void;
}

/**
 * Insertion-ordered, which is what makes "evict the most recent" expressible.
 */
const claims = new Set<LivePreviewClaim>();
const slotListeners = new Set<() => void>();

function notifySlotListeners(): void {
  for (const listener of slotListeners) listener();
}

/** Test-only: the registry is module-level and outlives a single render tree. */
export function resetLivePreviewSlots(): void {
  claims.clear();
  notifySlotListeners();
}

export function livePreviewSlotsInUse(): number {
  return claims.size;
}

/**
 * The **most recently granted** non-priority claim, or null if every slot is
 * held by a priority claimant.
 *
 * Most recent rather than oldest on purpose: the oldest slot is the one the
 * reader has had on screen longest and is most likely comparing against, so
 * taking the newest disturbs the least-established view.
 */
function findEvictable(): LivePreviewClaim | null {
  let victim: LivePreviewClaim | null = null;
  for (const claim of claims) {
    if (!claim.priority) victim = claim;
  }
  return victim;
}

function acquireSlot(claim: LivePreviewClaim): boolean {
  if (claims.has(claim)) return true;
  if (claims.size < MAX_CONCURRENT_LIVE_PREVIEWS) {
    claims.add(claim);
    return true;
  }
  if (!claim.priority) return false;

  const victim = findEvictable();
  if (!victim) return false;
  claims.delete(victim);
  claims.add(claim);
  // After the swap, so the victim re-running its acquire finds the registry
  // full and stays gated rather than thrashing against the popover.
  victim.yieldSlot();
  return true;
}

function releaseSlot(claim: LivePreviewClaim): void {
  // Idempotent: an evicted claimant's own cleanup runs after the evictor has
  // already removed it, and must not fire a second round of notifications.
  if (claims.delete(claim)) notifySlotListeners();
}

export interface LivePreviewSlotOptions {
  /**
   * Take a slot from a non-priority claimant rather than waiting for one. Only
   * the detail popover sets this; see the module header.
   */
  priority?: boolean;
}

export function useLivePreviewSlot<T extends HTMLElement>(
  enabled: boolean,
  options: LivePreviewSlotOptions = {},
) {
  const { priority = false } = options;
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  const [hasSlot, setHasSlot] = useState(false);
  const [slotVersion, setSlotVersion] = useState(0);

  /**
   * One claim object for this hook's lifetime. A fresh one per render would
   * make the registry unable to recognise a claimant it had already granted,
   * and `priority` is read at acquire time rather than captured.
   */
  const claimRef = useRef<LivePreviewClaim | null>(null);
  if (claimRef.current === null) {
    claimRef.current = { priority, yieldSlot: () => setHasSlot(false) };
  }
  claimRef.current.priority = priority;

  useEffect(() => {
    const listener = () => setSlotVersion((version) => version + 1);
    slotListeners.add(listener);
    return () => {
      slotListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node) return;
    if (typeof IntersectionObserver === 'undefined') {
      // No observer (jsdom, older embedders) means we cannot tell what is on
      // screen. Mounting is the honest default -- the cap below still bounds
      // the damage, and a preview that never appears is the worse failure.
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled]);

  useEffect(() => {
    const claim = claimRef.current;
    if (!claim) return;
    if (!enabled && hasSlot) {
      setHasSlot(false);
      return;
    }
    if (!enabled || !visible || hasSlot) return;
    if (acquireSlot(claim)) setHasSlot(true);
  }, [enabled, visible, hasSlot, slotVersion, priority]);

  useEffect(() => {
    if (!hasSlot) return;
    return () => {
      const claim = claimRef.current;
      if (claim) releaseSlot(claim);
    };
  }, [hasSlot]);

  return { ref, mounted: enabled && hasSlot };
}
