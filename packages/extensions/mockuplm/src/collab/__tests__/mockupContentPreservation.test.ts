// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { MockupPinRepository } from "../../comments/mockupPinRepository";
import type { MockupPin } from "../seed";
import { getYMockupText, seedMockupYDoc } from "../seed";
import { MockupBinding } from "../mockupBinding";
import { MockupHtmlCollabContentAdapter } from "../MockupCollabContentAdapters";

const PIN: MockupPin = {
  id: "pin-1",
  selector: "#save",
  labelSnapshot: "button:Save",
  offset: { xPct: 0.5, yPct: 0.5 },
  viewport: { width: 1440, label: "Desktop" },
  createdAt: 100,
  createdBy: "user-1",
};

describe("mockup HTML replacement", () => {
  it("preserves sibling pins and comments through applyFromFile and binding replacement", () => {
    const yDoc = new Y.Doc();
    seedMockupYDoc(yDoc, '<button id="save">Save</button>');
    const pins = new MockupPinRepository(yDoc);
    pins.create(PIN);
    const comments = yDoc.getArray<{ id: string }>("comments");
    comments.push([{ id: "thread-1" }]);

    MockupHtmlCollabContentAdapter.applyFromFile(
      yDoc,
      "<h1>AI replacement</h1>"
    );

    expect(getYMockupText(yDoc).toString()).toBe("<h1>AI replacement</h1>");
    expect(pins.snapshot()).toEqual([PIN]);
    expect(comments.toArray()).toEqual([{ id: "thread-1" }]);

    let editorHtml = "<main>Second wholesale replacement</main>";
    const binding = new MockupBinding(yDoc, getYMockupText(yDoc).toString(), {
      getCurrentHtml: () => editorHtml,
      onRemoteContent: (content) => {
        editorHtml = content;
      },
    });
    binding.syncNow();

    expect(getYMockupText(yDoc).toString()).toBe(
      "<main>Second wholesale replacement</main>"
    );
    expect(pins.snapshot()).toEqual([PIN]);
    expect(comments.toArray()).toEqual([{ id: "thread-1" }]);
    binding.destroy();
    pins.destroy();
    yDoc.destroy();
  });
});
