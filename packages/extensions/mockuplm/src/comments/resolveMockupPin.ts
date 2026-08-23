import type { MockupPin } from "../collab/seed";
import { generateSelector } from "../utils/generateSelector";
import type { MockupPinRepository } from "./mockupPinRepository";

export type MockupPinResolutionStatus =
  | "attached"
  | "healed"
  | "hidden"
  | "detached";

export interface MockupPinResolution {
  status: MockupPinResolutionStatus;
  target: Element | null;
  referenceBox: "element" | "document";
  /** Non-null only for an exact, unique label heal. */
  selectorUpdate: string | null;
}

export function createLabelSnapshot(element: Element): string {
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  return `${element.localName}:${text}`;
}

function query(document: Document, selector: string): Element[] {
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function labelMatches(document: Document, labelSnapshot: string): Element[] {
  return Array.from(document.querySelectorAll("*")).filter(
    (element) => createLabelSnapshot(element) === labelSnapshot
  );
}

/**
 * Whether the target exists in the HTML but is not on screen right now.
 *
 * Walks ancestors and reads computed style, so this is the expensive half of
 * resolution -- it must not run on scroll. See `resolveMockupPinAnchors`.
 */
function isHidden(element: Element): boolean {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    if (current.hasAttribute("hidden")) return true;

    const htmlElement = current as HTMLElement;
    if (htmlElement.style?.display === "none") return true;
    if (
      htmlElement.style?.visibility === "hidden" ||
      htmlElement.style?.visibility === "collapse"
    ) {
      return true;
    }

    const view = current.ownerDocument.defaultView;
    if (view) {
      const style = view.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      ) {
        return true;
      }
    }
  }
  return false;
}

function matched(
  target: Element,
  selectorUpdate: string | null
): MockupPinResolution {
  return {
    status: isHidden(target)
      ? "hidden"
      : selectorUpdate
      ? "healed"
      : "attached",
    target,
    referenceBox: "element",
    selectorUpdate,
  };
}

/**
 * Resolve one descriptive pin anchor against parsed HTML without touching Yjs,
 * an iframe, or editor state. A non-null selector update is a command for the
 * caller to persist the unique label heal.
 */
export function resolveMockupPin(
  document: Document,
  pin: MockupPin
): MockupPinResolution {
  if (pin.selector !== null) {
    const selectorMatches = query(document, pin.selector);
    if (selectorMatches.length === 1) return matched(selectorMatches[0], null);

    const matches = labelMatches(document, pin.labelSnapshot);
    if (matches.length === 1) {
      const target = matches[0];
      const repairedSelector = generateSelector(target);
      const repairedMatches = query(document, repairedSelector);
      if (repairedMatches.length === 1 && repairedMatches[0] === target) {
        return matched(target, repairedSelector);
      }
    }
  }

  if (pin.selector === null) {
    return {
      status: "attached",
      target: null,
      referenceBox: "document",
      selectorUpdate: null,
    };
  }

  return {
    status: "detached",
    target: null,
    referenceBox: "element",
    selectorUpdate: null,
  };
}

/** Resolve a pin and persist only the fail-closed repair emitted by the pure resolver. */
export function resolveAndHealMockupPin(
  document: Document,
  pin: MockupPin,
  repository: Pick<MockupPinRepository, "updateSelector">
): MockupPinResolution {
  const resolution = resolveMockupPin(document, pin);
  if (resolution.selectorUpdate) {
    repository.updateSelector(pin.id, resolution.selectorUpdate);
  }
  return resolution;
}
