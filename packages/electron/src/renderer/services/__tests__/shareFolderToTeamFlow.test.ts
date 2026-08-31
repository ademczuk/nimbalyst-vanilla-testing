// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shareFileToTeam: vi.fn(),
  discoverShareEmbeddedDocuments: vi.fn(
    async (_filePath: string): Promise<Array<Record<string, unknown>>> => []
  ),
  ensureSharedFolderSegments: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
  invoke: vi.fn(async () => ({})),
}));

vi.mock("@nimbalyst/runtime/store", () => ({
  store: { get: vi.fn(() => "/workspace") },
}));
vi.mock("../../store/atoms/collabDocuments", () => ({
  activeTeamOrgIdAtom: Symbol("activeTeamOrgId"),
  resolveDesktopCollabScope: vi.fn(async () => ({
    scope: { scopeKey: "/workspace", orgId: "team-1" },
    retryable: false,
  })),
}));
vi.mock("../../store/atoms/openProjects", () => ({
  activeWorkspacePathAtom: Symbol("activeWorkspace"),
}));
vi.mock("../../dialogs", () => ({
  dialogRef: { current: null },
  DIALOG_IDS: { SHARE_FOLDER_TO_TEAM: "share-folder-to-team" },
}));
vi.mock("../shareToTeamFlow", () => ({
  shareFileToTeam: mocks.shareFileToTeam,
  discoverShareEmbeddedDocuments: mocks.discoverShareEmbeddedDocuments,
  resolveShareDescriptor: vi.fn(),
}));
vi.mock("../sharedFolderPath", () => ({
  ensureSharedFolderSegments: mocks.ensureSharedFolderSegments,
}));
vi.mock("../ErrorNotificationService", () => ({
  errorNotificationService: {
    showError: mocks.showError,
    showInfo: mocks.showInfo,
    showWarning: mocks.showWarning,
  },
}));

import { shareFolderToTeam } from "../shareFolderToTeamFlow";
import type { FolderShareCandidateSet } from "../folderShareCandidates";

const markdown = { documentType: "markdown" } as never;

function candidate(relativePath: string) {
  const lastSlash = relativePath.lastIndexOf("/");
  return {
    relativePath,
    fileName: relativePath.slice(lastSlash + 1),
    parentRelativePath: lastSlash === -1 ? "" : relativePath.slice(0, lastSlash),
    descriptor: markdown,
  };
}

const answers = {
  folderId: "dest-folder",
  folderPath: "Team",
  sharedFolderName: "design",
};

beforeEach(() => {
  let nextFolderId = 0;
  mocks.ensureSharedFolderSegments.mockImplementation(
    async (_scope: unknown, segments: string[], parentId: string | null) =>
      `folder:${parentId ?? "root"}/${segments.join("/")}:${nextFolderId++}`
  );
  let nextDocumentId = 0;
  mocks.shareFileToTeam.mockImplementation(async () => ({
    status: "shared",
    documentId: `doc-${nextDocumentId++}`,
    orgId: "team-1",
    title: "t",
  }));
  (globalThis as any).window = { electronAPI: { invoke: mocks.invoke } };
});

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as any).window;
});

describe("shareFolderToTeam", () => {
  it("mirrors subfolders and places each file in its own mirrored folder", async () => {
    const candidateSet: FolderShareCandidateSet = {
      candidates: [candidate("readme.md"), candidate("sub/nested/spec.md")],
      skipped: [],
      subfolderPaths: ["sub", "sub/nested"],
    };

    await shareFolderToTeam({
      target: { folderPath: "/workspace/design", folderName: "design" },
      candidateSet,
      answers,
    });

    // Root folder first, then each mirrored segment under its own parent.
    const folderCalls = mocks.ensureSharedFolderSegments.mock.calls.map(
      (call) => [call[1], call[2]] as const
    );
    expect(folderCalls[0]).toEqual([["design"], "dest-folder"]);
    expect(folderCalls[1][0]).toEqual(["sub"]);
    expect(folderCalls[1][1]).toBe(await mocks.ensureSharedFolderSegments.mock.results[0].value);
    expect(folderCalls[2][0]).toEqual(["nested"]);
    expect(folderCalls[2][1]).toBe(await mocks.ensureSharedFolderSegments.mock.results[1].value);

    const byFile = new Map(
      mocks.shareFileToTeam.mock.calls.map((call) => [call[0].filePath, call[0]])
    );
    expect(byFile.get("/workspace/design/readme.md").answers.folderId).toBe(
      await mocks.ensureSharedFolderSegments.mock.results[0].value
    );
    expect(byFile.get("/workspace/design/sub/nested/spec.md").answers.folderId).toBe(
      await mocks.ensureSharedFolderSegments.mock.results[2].value
    );
    expect(byFile.get("/workspace/design/sub/nested/spec.md").answers.folderPath).toBe(
      "Team/design/sub/nested"
    );
  });

  it("links an in-batch embed to the copy this promote already published instead of creating a second one", async () => {
    // parent.md embeds child.md and both are in the batch. Left alone, the
    // embed cascade creates its own copy of child.md and the team ends up with
    // the same document twice.
    mocks.discoverShareEmbeddedDocuments.mockImplementation(
      async (filePath: string) =>
        filePath.endsWith("parent.md")
          ? [
              {
                absolutePath: "/workspace/design/child.md",
                sourceHref: "./child.md",
                fileName: "child.md",
                fileExtension: ".md",
                descriptor: markdown,
                occurrences: 1,
              },
            ]
          : []
    );

    const candidateSet: FolderShareCandidateSet = {
      candidates: [candidate("parent.md"), candidate("child.md")],
      skipped: [],
      subfolderPaths: [],
    };

    await shareFolderToTeam({
      target: { folderPath: "/workspace/design", folderName: "design" },
      candidateSet,
      answers,
    });

    const order = mocks.shareFileToTeam.mock.calls.map((call) => call[0].fileName);
    expect(order).toEqual(["child.md", "parent.md"]);

    const parentCall = mocks.shareFileToTeam.mock.calls[1][0];
    expect(parentCall.answers.selectedEmbeddedDocumentPaths).toEqual([
      "/workspace/design/child.md",
    ]);
    // Reused, not recreated: `alreadyShared` points at child.md's own share.
    expect(parentCall.answers.embeddedDocuments[0].alreadyShared).toEqual({
      documentId: "doc-0",
      orgId: "team-1",
    });
    // Per-file toasts stay off; the batch reports once.
    expect(parentCall.showNotifications).toBe(false);
    expect(mocks.showInfo).toHaveBeenCalledTimes(1);
  });

  it("refuses a folder over the document cap instead of publishing a prefix of it", async () => {
    const result = await shareFolderToTeam({
      target: { folderPath: "/workspace/design", folderName: "design" },
      candidateSet: {
        candidates: Array.from({ length: 101 }, (_, index) => candidate(`f${index}.md`)),
        skipped: [],
        subfolderPaths: [],
      },
      answers,
    });

    expect(result).toMatchObject({ status: "failed" });
    expect(mocks.shareFileToTeam).not.toHaveBeenCalled();
    expect(mocks.ensureSharedFolderSegments).not.toHaveBeenCalled();
    expect(mocks.showError.mock.calls[0][1]).toContain("101 shareable documents");
  });

  it("keeps going after one file fails and reports the survivors and the failure", async () => {
    mocks.shareFileToTeam
      .mockResolvedValueOnce({ status: "failed", error: "disk on fire" })
      .mockResolvedValueOnce({
        status: "shared",
        documentId: "doc-1",
        orgId: "team-1",
        title: "t",
      });

    const result = await shareFolderToTeam({
      target: { folderPath: "/workspace/design", folderName: "design" },
      candidateSet: {
        candidates: [candidate("a.md"), candidate("b.md")],
        skipped: [{ relativePath: "logo.png", fileName: "logo.png", reason: "no type" }],
        subfolderPaths: [],
      },
      answers,
    });

    expect(result).toMatchObject({
      sharedCount: 1,
      skippedCount: 1,
      failures: [{ relativePath: "a.md", error: "disk on fire" }],
    });
    expect(mocks.showWarning).toHaveBeenCalledTimes(1);
    expect(mocks.showInfo).not.toHaveBeenCalled();
  });
});
