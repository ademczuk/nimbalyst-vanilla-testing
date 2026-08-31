// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  collectFolderShareCandidates,
  type ShareDescriptorResolver,
} from "../folderShareCandidates";

const markdown = { documentType: "markdown" } as never;

const resolveByExtension: ShareDescriptorResolver = (fileName) =>
  fileName.endsWith(".md")
    ? { ok: true, descriptor: markdown }
    : { ok: false, reason: `No collaborative document type for "${fileName}".` };

describe("collectFolderShareCandidates", () => {
  it("separates eligible files from skipped ones and mirrors only folders that hold candidates", () => {
    const result = collectFolderShareCandidates(
      [
        "readme.md",
        "notes.txt",
        "design/login.md",
        "design/assets/logo.png",
        "design/deep/nested/spec.md",
      ],
      resolveByExtension
    );

    expect(result.candidates.map((candidate) => candidate.relativePath)).toEqual(
      ["readme.md", "design/login.md", "design/deep/nested/spec.md"]
    );
    expect(result.candidates[2]).toMatchObject({
      fileName: "spec.md",
      parentRelativePath: "design/deep/nested",
    });
    expect(result.skipped.map((file) => file.relativePath)).toEqual([
      "notes.txt",
      "design/assets/logo.png",
    ]);
    expect(result.skipped[0].reason).toContain("notes.txt");

    // `design/assets` holds nothing shareable, so it is never mirrored; every
    // ancestor of a candidate is, parents before children.
    expect(result.subfolderPaths).toEqual([
      "design",
      "design/deep",
      "design/deep/nested",
    ]);
  });

  it("returns nothing to create when no file in the folder is shareable", () => {
    const result = collectFolderShareCandidates(
      ["a.txt", "sub/b.bin"],
      resolveByExtension
    );

    expect(result.candidates).toEqual([]);
    expect(result.subfolderPaths).toEqual([]);
    expect(result.skipped).toHaveLength(2);
  });
});
