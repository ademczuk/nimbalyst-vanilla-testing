import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { MockupHtmlCollabContentAdapter } from "../MockupCollabContentAdapters";
import {
  createMockupPinAnchorAdapter,
  mockupPinAnchor,
} from "../../comments/mockupPinAnchor";
import { getYMockupPins, type MockupPin } from "../seed";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function pin(overrides: Partial<MockupPin> = {}): MockupPin {
  return {
    id: "pin-1",
    selector: "#save",
    labelSnapshot: "button:Save changes",
    offset: { xPct: 0.5, yPct: 0.5 },
    viewport: { width: 1440, label: "Desktop" },
    createdAt: 100,
    createdBy: "user-1",
    ...overrides,
  };
}

function seededDoc(html: string, value: MockupPin): Y.Doc {
  const yDoc = new Y.Doc();
  MockupHtmlCollabContentAdapter.seedFromFile(yDoc, html);
  getYMockupPins(yDoc).set(value.id, value);
  return yDoc;
}

describe("MockupLM codec comment anchors", () => {
  it("agrees with the mounted resolver while a target exists and after it is removed", () => {
    const value = pin();
    const yDoc = seededDoc('<button id="save">Save changes</button>', value);
    const anchor = mockupPinAnchor(value.id, value.labelSnapshot);
    const codec = MockupHtmlCollabContentAdapter.commentAnchors!;
    let document = parse(
      MockupHtmlCollabContentAdapter.exportToFile(yDoc) as string
    );
    const mounted = createMockupPinAnchorAdapter({
      getPins: () => [value],
      getDocument: () => document,
    });

    expect(codec.handles(anchor)).toBe(true);
    expect(codec.getState(yDoc, anchor)).toBe("attached");
    expect(codec.getState(yDoc, anchor)).toBe(mounted.getState(anchor));

    MockupHtmlCollabContentAdapter.applyFromFile(yDoc, "<p>Rewritten</p>");
    document = parse(
      MockupHtmlCollabContentAdapter.exportToFile(yDoc) as string
    );

    expect(codec.getState(yDoc, anchor)).toBe("orphaned");
    expect(codec.getState(yDoc, anchor)).toBe(mounted.getState(anchor));
  });

  it("uses unique-label healing for its verdict without mutating the Y.Doc on reads", () => {
    const value = pin({ selector: "#removed" });
    const yDoc = seededDoc(
      '<main><button class="primary">Save changes</button></main>',
      value
    );
    const anchor = mockupPinAnchor(value.id, value.labelSnapshot);
    const codec = MockupHtmlCollabContentAdapter.commentAnchors!;
    const before = Y.encodeStateAsUpdate(yDoc);

    expect(codec.getState(yDoc, anchor)).toBe("attached");
    expect(Y.encodeStateAsUpdate(yDoc)).toEqual(before);
    expect(codec.describe(yDoc, anchor)).toBe("Save changes button");
    expect(Y.encodeStateAsUpdate(yDoc)).toEqual(before);
    expect(getYMockupPins(yDoc).get(value.id)?.selector).toBe("#removed");
  });

  it("claims only mockup-pin anchors and fails closed for a missing pin", () => {
    const yDoc = seededDoc("<main></main>", pin());
    const codec = MockupHtmlCollabContentAdapter.commentAnchors!;

    expect(
      codec.handles({
        kind: "entity",
        entityType: "graph-node",
        entityId: "n1",
      })
    ).toBe(false);
    expect(codec.handles({ kind: "text-quote", exact: "Save" })).toBe(false);
    expect(
      codec.getState(yDoc, mockupPinAnchor("missing", "button:Save"))
    ).toBe("orphaned");
  });
});
