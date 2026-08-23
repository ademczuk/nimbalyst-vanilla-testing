/**
 * The mockup half of the platform's entity comment anchor.
 *
 * The shared anchor deliberately carries no geometry: `entityType`,
 * `entityId`, and a `labelSnapshot` are the whole of it, and every selector,
 * offset, and viewport stays in the extension's own `mockupPins` Y.Map. A
 * reader of the canonical `comments` array -- an agent, the inbox, a future
 * editor -- can therefore say which element a thread is about without
 * understanding anything about mockup DOM.
 *
 * Everything here is pure: an anchor, a pin snapshot, and a parsed document in;
 * a state, a label, or a scroll command out. The React layer supplies the live
 * document and owns nothing else.
 */

import type {
  CommentAnchor,
  EntityCommentAnchor,
  MountedCommentAnchorAdapter,
} from "@nimbalyst/extension-sdk";
import {
  numberUnresolvedPins,
  type MockupPinSnapshot,
} from "./mockupPinRepository";
import { resolveMockupPin } from "./resolveMockupPin";

export const MOCKUP_PIN_ENTITY_TYPE = "mockup-pin";

/** Keeps a quote readable in an inbox line; the pin itself holds the detail. */
const MAX_LABEL_CHARS = 60;

export function mockupPinAnchor(
  pinId: string,
  labelSnapshot: string
): EntityCommentAnchor {
  return {
    kind: "entity",
    entityType: MOCKUP_PIN_ENTITY_TYPE,
    entityId: pinId,
    labelSnapshot,
  };
}

export function isMockupPinAnchor(
  anchor: CommentAnchor | undefined
): anchor is EntityCommentAnchor {
  return (
    anchor?.kind === "entity" && anchor.entityType === MOCKUP_PIN_ENTITY_TYPE
  );
}

export function mockupPinIdFromAnchor(
  anchor: CommentAnchor | undefined
): string | null {
  return isMockupPinAnchor(anchor) ? anchor.entityId || null : null;
}

/**
 * Turn a `tag:text` label snapshot into prose. The snapshot format is an
 * implementation detail of healing; nobody outside the extension should have
 * to parse it to read a comment.
 */
export function describeMockupPinTarget(labelSnapshot: string): string {
  const separator = labelSnapshot.indexOf(":");
  if (separator === -1) return labelSnapshot.trim() || "empty space";

  const tag = labelSnapshot.slice(0, separator).trim();
  const text = labelSnapshot.slice(separator + 1).trim();
  if (!tag && !text) return "empty space";
  if (!text) return tag;

  const clipped =
    text.length > MAX_LABEL_CHARS
      ? `${text.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…`
      : text;
  return tag ? `${clipped} ${tag}` : clipped;
}

/**
 * The thread's human-readable quote, e.g. `Pin 3 — Sign in button`.
 *
 * This is what the platform stores as `thread.quote`: the host derives the
 * quote from {@link createMockupPinAnchorAdapter}'s `describe`, so a reader of
 * the canonical comments array -- an agent, the inbox, a notification -- gets
 * prose without ever seeing a selector.
 *
 * The number is the live one, matching the disc drawn on the canvas at the
 * moment it is read. The stored quote is a snapshot of that from creation
 * time; renumbering deliberately does not rewrite history, because churning
 * every thread on every delete would make old notifications disagree with the
 * document they point at.
 */
export function mockupPinQuote(
  pinNumber: number,
  labelSnapshot: string
): string {
  return `Pin ${pinNumber} — ${describeMockupPinTarget(labelSnapshot)}`;
}

export interface MockupPinAnchorSources {
  /** Current pins, from the same store the overlay renders. */
  getPins(): readonly MockupPinSnapshot[];
  /**
   * The live mockup document, or null when the frame is not mounted. Null is
   * "cannot measure", never "gone" -- see {@link mockupPinAnchorState}.
   */
  getDocument(): Document | null;
  /**
   * Pins whose thread is resolved. They keep their pin but lose their number,
   * which is what makes numbering gap-free. Absent means "none resolved".
   */
  getResolvedPinIds?(): ReadonlySet<string>;
}

function findPin(
  pins: readonly MockupPinSnapshot[],
  pinId: string
): MockupPinSnapshot | undefined {
  return pins.find((pin) => pin.id === pinId);
}

/**
 * Map the four-step resolver onto the platform's two-state anchor vocabulary.
 *
 * `hidden` is attached on purpose: the element still exists in the HTML, it is
 * just inside a currently-false branch. Calling that orphaned would move a live
 * thread into the detached tray every time a prototype toggled a section.
 *
 * A missing pin record is the only true orphan -- the entity the anchor names
 * is gone. An unmeasurable document is not evidence of anything, so it reports
 * attached rather than guessing.
 */
export function mockupPinAnchorState(
  anchor: CommentAnchor | undefined,
  sources: MockupPinAnchorSources
): "attached" | "orphaned" {
  const pinId = mockupPinIdFromAnchor(anchor);
  if (!pinId) return "orphaned";

  const pin = findPin(sources.getPins(), pinId);
  if (!pin) return "orphaned";

  const document = sources.getDocument();
  if (!document) return "attached";

  return resolveMockupPin(document, pin).status === "detached"
    ? "orphaned"
    : "attached";
}

/**
 * Bring a pin's target into view inside the mockup frame. Returns whether the
 * frame actually moved somewhere meaningful, which is what `focusThread`
 * reports back to the panel.
 */
export function scrollMockupPinIntoView(
  document: Document,
  pin: MockupPinSnapshot
): boolean {
  const resolution = resolveMockupPin(document, pin);
  if (resolution.status === "detached") return false;

  if (resolution.target) {
    resolution.target.scrollIntoView({ block: "center", inline: "nearest" });
    return true;
  }

  // A free pin has no element; scroll the document box to its stored ratio.
  const view = document.defaultView;
  const root = document.documentElement;
  if (!view || !root) return false;
  view.scrollTo({
    left: pin.offset.xPct * root.scrollWidth - view.innerWidth / 2,
    top: pin.offset.yPct * root.scrollHeight - view.innerHeight / 2,
  });
  return true;
}

/**
 * The adapter the host registers for `entityType: 'mockup-pin'`. It is the
 * only thing that teaches the platform where a mockup thread points -- the
 * anchor itself stays geometry-free.
 *
 * It carries more weight than a panel decoration. `createThread` refuses an
 * anchor this adapter does not report `attached`, and takes the thread's quote
 * straight from `describe`. Registration therefore has to be live before the
 * first placement, and `describe` has to read the current pin set rather than
 * anything captured at registration time.
 */
export function createMockupPinAnchorAdapter(
  sources: MockupPinAnchorSources
): MountedCommentAnchorAdapter {
  return {
    handles(anchor) {
      return isMockupPinAnchor(anchor);
    },

    getState(anchor) {
      return mockupPinAnchorState(anchor, sources);
    },

    describe(anchor) {
      const pinId = mockupPinIdFromAnchor(anchor);
      const pins = sources.getPins();
      const pin = pinId ? findPin(pins, pinId) : undefined;
      const label =
        pin?.labelSnapshot ??
        (isMockupPinAnchor(anchor) ? anchor.labelSnapshot ?? "" : "");
      if (!pin || !pinId) return describeMockupPinTarget(label);

      const number = numberUnresolvedPins(
        pins,
        sources.getResolvedPinIds?.()
      ).get(pinId);
      // A resolved pin has no number by design; describing it as "Pin 0" would
      // be worse than describing only its target.
      return number
        ? mockupPinQuote(number, label)
        : describeMockupPinTarget(label);
    },

    focus(anchor) {
      const pinId = mockupPinIdFromAnchor(anchor);
      const document = sources.getDocument();
      if (!pinId || !document) return false;
      const pin = findPin(sources.getPins(), pinId);
      return pin ? scrollMockupPinIntoView(document, pin) : false;
    },
  };
}
