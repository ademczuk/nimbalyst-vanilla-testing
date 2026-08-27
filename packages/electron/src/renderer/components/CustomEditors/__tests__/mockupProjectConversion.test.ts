// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type {
  EditorHostFileSystem,
  ProjectFileSnapshot,
} from "@nimbalyst/runtime";

import {
  MockupProjectConversionError,
  convertMockupProjectFile,
} from "../mockupProjectConversion";

describe("convertMockupProjectFile", () => {
  it("refuses to overwrite an existing canvas and leaves the source intact", async () => {
    const sourcePath = "/workspace/checkout.mockupproject";
    const targetPath = "/workspace/checkout.canvas";
    const sourceContent = JSON.stringify({
      version: 1,
      name: "Checkout flow",
      mockups: [],
      connections: [],
    });
    const files = new Map([
      [sourcePath, sourceContent],
      [targetPath, '{"existing":true}'],
    ]);
    const snapshot = (path: string): ProjectFileSnapshot => {
      const content = files.get(path) ?? null;
      return {
        path,
        exists: content !== null,
        content,
        sha256: content === null ? null : `sha:${content}`,
      };
    };
    const write = vi.fn<EditorHostFileSystem["write"]>();
    const fs: EditorHostFileSystem = {
      read: async (paths) => paths.map(snapshot),
      write,
      onChanged: () => () => {},
    };

    await expect(
      convertMockupProjectFile(fs, sourcePath)
    ).rejects.toMatchObject({
      name: MockupProjectConversionError.name,
      code: "target-exists",
    });

    expect(write).not.toHaveBeenCalled();
    expect(files.get(sourcePath)).toBe(sourceContent);
    expect(files.get(targetPath)).toBe('{"existing":true}');
  });
});
