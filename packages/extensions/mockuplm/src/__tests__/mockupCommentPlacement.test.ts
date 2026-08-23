import { describe, expect, it, vi } from "vitest";
import { capturePinDraft } from "../comments/capturePinDraft";
import {
  createMockupPinAnchorAdapter,
  mockupPinAnchor,
} from "../comments/mockupPinAnchor";
import {
  measureResolvedPins,
  resolveMockupPinAnchors,
} from "../comments/measureMockupPins";
import { createInMemoryMockupPinStore } from "../comments/mockupPinStore";
import type { MockupPin } from "../collab/seed";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function stubRect(
  element: Element,
  rect: { left: number; top: number; width: number; height: number }
): void {
  element.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }) as DOMRect;
}

function stubScrollBox(document: Document, width: number, height: number): void {
  Object.defineProperty(document.documentElement, "scrollWidth", { value: width });
  Object.defineProperty(document.documentElement, "scrollHeight", { value: height });
}

function pin(overrides: Partial<MockupPin> = {}): MockupPin {
  return {
    id: "pin-1",
    selector: "#save",
    labelSnapshot: "button:Save changes",
    offset: { xPct: 0.5, yPct: 0.25 },
    viewport: { width: 1440, label: "Desktop" },
    createdAt: 100,
    createdBy: "user-1",
    ...overrides,
  };
}

describe("pin placement capture", () => {
  it("anchors to the clicked element with the offset inside its box", () => {
    const document = parse('<button id="save">Save changes</button>');
    const target = document.querySelector("button")!;
    stubRect(target, { left: 100, top: 50, width: 200, height: 40 });

    const draft = capturePinDraft({
      document,
      target,
      clientX: 150,
      clientY: 80,
      viewport: { width: 1440, label: "Desktop" },
    });

    expect(draft).toEqual({
      selector: "#save",
      labelSnapshot: "button:Save changes",
      offset: { xPct: 0.25, yPct: 0.75 },
      viewport: { width: 1440, label: "Desktop" },
    });
  });

  it("drops a free pin measured against the document box when whitespace is clicked", () => {
    const document = parse("<body><button>Save changes</button></body>");
    stubScrollBox(document, 1000, 2000);

    const draft = capturePinDraft({
      document,
      target: document.body,
      clientX: 250,
      clientY: 500,
      viewport: { width: 1024, label: "Laptop" },
    });

    expect(draft.selector).toBeNull();
    expect(draft.offset).toEqual({ xPct: 0.25, yPct: 0.25 });
  });
});

describe("mockup pin anchor adapter", () => {
  const adapterOver = (
    document: Document | null,
    store = createInMemoryMockupPinStore()
  ) => ({
    store,
    adapter: createMockupPinAnchorAdapter({
      getPins: () => store.snapshot(),
      getDocument: () => document,
    }),
  });

  it("only claims mockup pin anchors", () => {
    const { adapter } = adapterOver(null);
    expect(adapter.handles(mockupPinAnchor("pin-1", "button:Save"))).toBe(true);
    expect(
      adapter.handles({ kind: "entity", entityType: "graph-node", entityId: "n1" })
    ).toBe(false);
    expect(adapter.handles({ kind: "text-quote", exact: "Save" })).toBe(false);
  });

  it("reports attached while the element resolves and orphaned once it is gone", () => {
    const document = parse('<button id="save">Save changes</button>');
    const { store, adapter } = adapterOver(document);
    store.create(pin());
    const anchor = mockupPinAnchor("pin-1", "button:Save changes");

    expect(adapter.getState(anchor)).toBe("attached");
    // The quote the platform stores: prose and a live number, never a selector.
    expect(adapter.describe(anchor)).toBe("Pin 1 \u2014 Save changes button");

    document.body.innerHTML = "<p>Rewritten by the AI</p>";
    expect(adapter.getState(anchor)).toBe("orphaned");
  });

  it("keeps a hidden target attached but calls a deleted pin orphaned", () => {
    const document = parse(
      '<section hidden><button id="save">Save changes</button></section>'
    );
    const { store, adapter } = adapterOver(document);
    store.create(pin());
    const anchor = mockupPinAnchor("pin-1", "button:Save changes");

    // The element is in the HTML, just inside a false branch. Detaching a live
    // thread every time a prototype toggled a section would be a lie.
    expect(adapter.getState(anchor)).toBe("attached");

    store.delete("pin-1");
    expect(adapter.getState(anchor)).toBe("orphaned");
  });

  it("focuses a pin by scrolling its target into view", () => {
    const document = parse('<button id="save">Save changes</button>');
    const target = document.querySelector("button")!;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    const { store, adapter } = adapterOver(document);
    store.create(pin());

    expect(adapter.focus(mockupPinAnchor("pin-1", "button:Save changes"))).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(adapter.focus(mockupPinAnchor("pin-missing", ""))).toBe(false);
  });
});

describe("pin measurement", () => {
  it("places an attached pin at the element box plus its offset", () => {
    const document = parse('<button id="save">Save changes</button>');
    stubRect(document.querySelector("button")!, {
      left: 100,
      top: 50,
      width: 200,
      height: 40,
    });
    const store = createInMemoryMockupPinStore();
    store.create(pin());

    const layout = measureResolvedPins(
      document,
      resolveMockupPinAnchors(document, store.snapshot(), store)
    );

    expect(layout.placements).toHaveLength(1);
    expect(layout.placements[0]).toMatchObject({ status: "attached", left: 200, top: 60 });
  });

  it("collapses a pin on a non-rendered element instead of drawing it at a stale spot", () => {
    const document = parse(
      '<section hidden><button id="save">Save changes</button></section>'
    );
    const store = createInMemoryMockupPinStore();
    store.create(pin());

    const layout = measureResolvedPins(
      document,
      resolveMockupPinAnchors(document, store.snapshot(), store)
    );

    expect(layout.placements).toEqual([]);
    expect(layout.detached).toEqual([]);
    expect(layout.hidden.map(({ id }) => id)).toEqual(["pin-1"]);
  });

  it("keeps an unfindable anchor out of the canvas and persists a unique heal", () => {
    const document = parse('<main><button class="primary">Save changes</button></main>');
    stubRect(document.querySelector("button")!, {
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
    const store = createInMemoryMockupPinStore();
    store.create(pin({ selector: "#removed" }));
    store.create(pin({ id: "pin-2", selector: "#gone", labelSnapshot: "button:Vanished" }));

    const layout = measureResolvedPins(
      document,
      resolveMockupPinAnchors(document, store.snapshot(), store)
    );

    expect(layout.placements.map(({ pin: placed }) => placed.id)).toEqual(["pin-1"]);
    expect(layout.detached.map(({ id }) => id)).toEqual(["pin-2"]);
    expect(store.snapshot().find(({ id }) => id === "pin-1")?.selector).toBe(".primary");
    expect(store.snapshot().find(({ id }) => id === "pin-2")?.selector).toBe("#gone");
  });
});
