/**
 * The narrow pin surface the overlay consumes.
 *
 * `MockupPinRepository` (Y.Doc backed) is the production implementation. The
 * overlay depends on this interface instead of the class so that measurement,
 * numbering, and rendering can be exercised without a Y.Doc -- and so a mockup
 * opened outside a collaborative room still has somewhere to put a pin.
 */

import { Doc as YDoc } from "yjs";
import type { MockupPin } from "../collab/seed";
import { MockupPinRepository, type MockupPinSnapshot } from "./mockupPinRepository";

export interface MockupPinStore {
  create(pin: MockupPin): void;
  updateSelector(pinId: string, selector: string): boolean;
  delete(pinId: string): boolean;
  snapshot(): readonly MockupPinSnapshot[];
  subscribe(listener: () => void): () => void;
}

/**
 * Wrap a store so its methods can be passed around detached from the instance
 * -- `useSyncExternalStore(store.subscribe, store.snapshot)` would otherwise
 * call the repository's class methods with no `this`.
 */
export function bindMockupPinStore(store: MockupPinStore): MockupPinStore {
  return {
    create: (pin) => store.create(pin),
    updateSelector: (pinId, selector) => store.updateSelector(pinId, selector),
    delete: (pinId) => store.delete(pinId),
    snapshot: () => store.snapshot(),
    subscribe: (listener) => store.subscribe(listener),
  };
}

/**
 * A pin store over a private, unshared Y.Doc.
 *
 * This is the production repository, not a second implementation of it: an
 * earlier standalone version carried its own copies of the ordering and
 * freezing rules, which is exactly the kind of duplicate that answers
 * differently from the real one once either side is edited.
 *
 * Used by tests that exercise placement, numbering and measurement without a
 * room. Production reaches it only through `useMockupComments`, where a mockup
 * outside a room has no comments service either, so nothing ever writes to it.
 */
export function createInMemoryMockupPinStore(): MockupPinStore {
  return bindMockupPinStore(new MockupPinRepository(new YDoc()));
}
