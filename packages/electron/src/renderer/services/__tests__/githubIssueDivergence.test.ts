// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  detectGithubIssueDivergence,
  type GithubIssueLocalSnapshot,
  type GithubIssueUpstreamSnapshot,
} from "../githubIssueDivergence";

const upstream: GithubIssueUpstreamSnapshot = {
  state: "open",
  title: "Terminal crashes on launch",
  labels: [{ name: "bug" }, { name: "desktop" }],
};

const local: GithubIssueLocalSnapshot = {
  state: "open",
  titleSnapshot: "Terminal crashes on launch",
  labels: ["bug", "desktop"],
  upstreamBodyChanged: false,
};

describe("detectGithubIssueDivergence", () => {
  it("reports both directions of upstream/local state disagreement", () => {
    expect(
      detectGithubIssueDivergence({ ...upstream, state: "closed" }, local).state
    ).toEqual({ upstream: "closed", local: "open" });
    expect(
      detectGithubIssueDivergence(upstream, { ...local, state: "closed" }).state
    ).toEqual({ upstream: "open", local: "closed" });
  });

  it("compares the upstream title to the importer snapshot, not the editable local title", () => {
    const result = detectGithubIssueDivergence(
      { ...upstream, title: "Terminal crashes after update" },
      local
    );

    expect(result.title).toEqual({
      upstream: "Terminal crashes after update",
      snapshot: "Terminal crashes on launch",
    });
    expect(result.axes).toEqual(["title"]);
  });

  it("surfaces the body flag set by TrackerImportService without trying to diff bodies", () => {
    const result = detectGithubIssueDivergence(upstream, {
      ...local,
      upstreamBodyChanged: true,
    });

    expect(result.upstreamBodyChanged).toBe(true);
    expect(result.axes).toEqual(["body"]);
  });

  it("reports upstream labels missing locally while ignoring case and local-only labels", () => {
    const result = detectGithubIssueDivergence(
      {
        ...upstream,
        labels: [{ name: "Bug" }, { name: "desktop" }, { name: "regression" }],
      },
      { ...local, labels: ["bug", "desktop", "internal-priority"] }
    );

    expect(result.addedUpstreamLabels).toEqual(["regression"]);
    expect(result.axes).toEqual(["labels"]);
  });

  it("returns a stable empty result when every comparable snapshot agrees", () => {
    expect(detectGithubIssueDivergence(upstream, local)).toEqual({
      needsAttention: false,
      axes: [],
      state: null,
      title: null,
      upstreamBodyChanged: false,
      addedUpstreamLabels: [],
    });
  });
});
