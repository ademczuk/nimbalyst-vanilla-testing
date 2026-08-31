// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  orderCandidatesByEmbedDependency,
  reportFolderShareOutcome,
} from "../folderSharePlan";
import type { FolderShareCandidate } from "../folderShareCandidates";

function candidate(relativePath: string): FolderShareCandidate {
  const lastSlash = relativePath.lastIndexOf("/");
  return {
    relativePath,
    fileName: relativePath.slice(lastSlash + 1),
    parentRelativePath: lastSlash === -1 ? "" : relativePath.slice(0, lastSlash),
    descriptor: { documentType: "markdown" } as never,
  };
}

describe("orderCandidatesByEmbedDependency", () => {
  it("publishes an embedded file before the file that embeds it", () => {
    // Without this, sharing `parent.md` first makes the embed cascade create a
    // second copy of `child.md` -- a document this batch already owns.
    const candidates = [candidate("parent.md"), candidate("child.md")];
    const ordered = orderCandidatesByEmbedDependency(
      candidates,
      new Map([["parent.md", new Set(["child.md"])]])
    );

    expect(ordered.map((entry) => entry.relativePath)).toEqual([
      "child.md",
      "parent.md",
    ]);
  });

  it("orders a chain deepest-dependency first and emits every candidate exactly once", () => {
    const candidates = [
      candidate("a.md"),
      candidate("b.md"),
      candidate("c.md"),
      candidate("standalone.md"),
    ];
    const ordered = orderCandidatesByEmbedDependency(
      candidates,
      new Map([
        ["a.md", new Set(["b.md"])],
        ["b.md", new Set(["c.md"])],
      ])
    );

    expect(ordered.map((entry) => entry.relativePath)).toEqual([
      "c.md",
      "b.md",
      "a.md",
      "standalone.md",
    ]);
  });

  it("does not drop or duplicate candidates when the embed graph has a cycle", () => {
    const candidates = [candidate("x.md"), candidate("y.md")];
    const ordered = orderCandidatesByEmbedDependency(
      candidates,
      new Map([
        ["x.md", new Set(["y.md"])],
        ["y.md", new Set(["x.md"])],
      ])
    );

    expect(ordered.map((entry) => entry.relativePath).sort()).toEqual([
      "x.md",
      "y.md",
    ]);
  });
});

describe("reportFolderShareOutcome", () => {
  function notifiers() {
    return { showError: vi.fn(), showWarning: vi.fn(), showInfo: vi.fn() };
  }

  it("warns rather than reporting plain success when some files were left behind", () => {
    const notify = notifiers();
    reportFolderShareOutcome({
      folderName: "design",
      sharedFolderPath: "Team/design",
      sharedCount: 9,
      skippedCount: 6,
      failures: [{ relativePath: "a.md", error: "boom" }],
      warnings: [],
      skipped: [{ relativePath: "logo.png", reason: "no document type" }],
      ...notify,
    });

    expect(notify.showInfo).not.toHaveBeenCalled();
    const [title, body, options] = notify.showWarning.mock.calls[0];
    expect(title).toBe("Folder shared with exceptions");
    expect(body).toContain("Shared 9 documents");
    expect(body).toContain("1 failed to share");
    expect(body).toContain("6 files had no collaborative document type");
    // The names, not just the counts -- the author has to be able to act on it.
    expect(options.details).toContain("a.md: boom");
    expect(options.details).toContain("logo.png: no document type");
  });

  it("reports plain success only when nothing was skipped, failed, or degraded", () => {
    const notify = notifiers();
    reportFolderShareOutcome({
      folderName: "design",
      sharedFolderPath: "Team/design",
      sharedCount: 3,
      skippedCount: 0,
      failures: [],
      warnings: [],
      skipped: [],
      ...notify,
    });

    expect(notify.showWarning).not.toHaveBeenCalled();
    expect(notify.showInfo.mock.calls[0][1]).toContain("Shared 3 documents");
  });

  it("errors when nothing landed at all", () => {
    const notify = notifiers();
    reportFolderShareOutcome({
      folderName: "design",
      sharedFolderPath: "",
      sharedCount: 0,
      skippedCount: 2,
      failures: [],
      warnings: [],
      skipped: [
        { relativePath: "a.png", reason: "no document type" },
        { relativePath: "b.zip", reason: "no document type" },
      ],
      ...notify,
    });

    expect(notify.showInfo).not.toHaveBeenCalled();
    expect(notify.showWarning).not.toHaveBeenCalled();
    expect(notify.showError.mock.calls[0][0]).toBe("Nothing was shared");
  });
});
