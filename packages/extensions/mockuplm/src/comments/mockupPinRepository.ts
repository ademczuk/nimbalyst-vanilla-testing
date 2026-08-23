import * as Y from "yjs";
import { getYMockupPins, type MockupPin } from "../collab/seed";

export type MockupPinSnapshot = Readonly<
  Omit<MockupPin, "offset" | "viewport"> & {
    offset: Readonly<MockupPin["offset"]>;
    viewport: Readonly<MockupPin["viewport"]>;
  }
>;

function immutablePin(pin: MockupPin): MockupPinSnapshot {
  return Object.freeze({
    ...pin,
    offset: Object.freeze({ ...pin.offset }),
    viewport: Object.freeze({ ...pin.viewport }),
  });
}

function comparePins(a: MockupPinSnapshot, b: MockupPinSnapshot): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export class MockupPinRepository {
  private readonly yPins: Y.Map<MockupPin>;
  private readonly listeners = new Set<() => void>();
  private cachedSnapshot: readonly MockupPinSnapshot[] | null = null;
  private destroyed = false;

  private readonly onPinsChanged = (): void => {
    this.cachedSnapshot = null;
    for (const listener of this.listeners) listener();
  };

  constructor(yDoc: Y.Doc) {
    this.yPins = getYMockupPins(yDoc);
    this.yPins.observe(this.onPinsChanged);
  }

  create(pin: MockupPin): void {
    if (this.yPins.has(pin.id)) {
      throw new Error(`Mockup pin already exists: ${pin.id}`);
    }
    this.yPins.set(pin.id, immutablePin(pin) as MockupPin);
  }

  updateSelector(pinId: string, selector: string): boolean {
    const current = this.yPins.get(pinId);
    if (!current || current.selector === selector) return false;
    this.yPins.set(pinId, immutablePin({ ...current, selector }) as MockupPin);
    return true;
  }

  delete(pinId: string): boolean {
    if (!this.yPins.has(pinId)) return false;
    this.yPins.delete(pinId);
    return true;
  }

  snapshot(): readonly MockupPinSnapshot[] {
    if (!this.cachedSnapshot) {
      const pins = Array.from(this.yPins.values(), immutablePin).sort(
        comparePins
      );
      this.cachedSnapshot = Object.freeze(pins);
    }
    return this.cachedSnapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.yPins.unobserve(this.onPinsChanged);
    this.listeners.clear();
  }
}

/** Deterministic, gap-free numbering for pins whose threads are unresolved. */
export function numberUnresolvedPins(
  pins: Iterable<MockupPinSnapshot>,
  resolvedPinIds: ReadonlySet<string> = new Set()
): ReadonlyMap<string, number> {
  const unresolved = Array.from(pins)
    .filter((pin) => !resolvedPinIds.has(pin.id))
    .sort(comparePins);
  return new Map(unresolved.map((pin, index) => [pin.id, index + 1]));
}
