// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  GithubIssueAdoptionService,
  type GithubIssueAdoptionDependencies,
  type GithubIssueOverlay,
} from "../GithubIssueAdoptionService";

function inMemoryDependencies() {
  const importedItems = new Set<string>();
  const overlays = new Map<string, GithubIssueOverlay>();
  let overlaySequence = 0;

  const dependencies: GithubIssueAdoptionDependencies = {
    findOverlay: async (_workspacePath, remote, number) =>
      overlays.get(`${remote}#${number}`) ?? null,
    runImport: async ({ externalId }) => {
      // Deliberately non-idempotent: the coordinator must prevent a second
      // import call rather than inheriting idempotence from this dependency.
      const id = `imported:${externalId}:${importedItems.size + 1}`;
      importedItems.add(id);
      return { id, urn: `github://${externalId}`, created: true };
    },
    loadIssueMetadata: async (_workspacePath, remote, number) => ({
      title: `Issue ${number}`,
      authorLogin: "octocat",
      issueUrl: `https://github.com/${remote}/issues/${number}`,
    }),
    createAdoptedOverlay: async (args) => {
      const overlay = {
        id: `overlay-${++overlaySequence}`,
        status: "adopted",
        adoptedItemId: args.adoptedItemId,
      };
      overlays.set(`${args.remote}#${args.number}`, overlay);
      return overlay.id;
    },
    markOverlayAdopted: async (_workspacePath, overlayId, adoptedItemId) => {
      const entry = [...overlays.entries()].find(
        ([, overlay]) => overlay.id === overlayId
      );
      if (!entry) throw new Error(`Missing overlay ${overlayId}`);
      entry[1].status = "adopted";
      entry[1].adoptedItemId = adoptedItemId;
    },
  };

  return { dependencies, importedItems, overlays };
}

describe("GithubIssueAdoptionService", () => {
  it("converges concurrent and repeated adoption onto one imported item and one overlay", async () => {
    const state = inMemoryDependencies();
    const service = new GithubIssueAdoptionService(state.dependencies);
    const args = {
      workspacePath: "/workspace",
      remote: "owner/repo",
      number: 42,
    };

    const [first, concurrent] = await Promise.all([
      service.adopt(args),
      service.adopt(args),
    ]);
    const repeated = await service.adopt(args);

    expect(first.adoptedItemId).toBe("imported:owner/repo#42:1");
    expect(concurrent.adoptedItemId).toBe(first.adoptedItemId);
    expect(repeated).toEqual({
      adoptedItemId: first.adoptedItemId,
      overlayItemId: first.overlayItemId,
      urn: "github://owner/repo#42",
      importCreated: false,
      overlayCreated: false,
    });
    expect(state.importedItems).toEqual(new Set(["imported:owner/repo#42:1"]));
    expect(state.overlays.size).toBe(1);
  });

  it("leaves an existing overlay untouched when the importer fails", async () => {
    const state = inMemoryDependencies();
    state.overlays.set("owner/repo#42", {
      id: "overlay-ready",
      status: "ready",
    });
    state.dependencies.runImport = async () => {
      throw new Error("upstream fetch failed");
    };
    const service = new GithubIssueAdoptionService(state.dependencies);

    await expect(
      service.adopt({
        workspacePath: "/workspace",
        remote: "owner/repo",
        number: 42,
      })
    ).rejects.toThrow("upstream fetch failed");
    expect(state.overlays.get("owner/repo#42")).toEqual({
      id: "overlay-ready",
      status: "ready",
    });
    expect(state.importedItems.size).toBe(0);
  });
});
