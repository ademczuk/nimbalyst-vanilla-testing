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
/**
 * Enough for the "pick one of these three" case with headroom, low enough that
 * a long list of requests cannot mount editors without bound.
 */
export declare const MAX_CONCURRENT_LIVE_PREVIEWS = 4;
/** Test-only: the registry is module-level and outlives a single render tree. */
export declare function resetLivePreviewSlots(): void;
export declare function livePreviewSlotsInUse(): number;
export interface LivePreviewSlotOptions {
    /**
     * Take a slot from a non-priority claimant rather than waiting for one. Only
     * the detail popover sets this; see the module header.
     */
    priority?: boolean;
}
export declare function useLivePreviewSlot<T extends HTMLElement>(enabled: boolean, options?: LivePreviewSlotOptions): {
    ref: import("react").RefObject<T | null>;
    mounted: boolean;
};
