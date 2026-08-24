/** Typed renderer facade for the workspace-scoped GitHub issue IPC contract. */

import type { GithubIssueListOptions } from "../../main/services/GhApiService.issues";
import type { GithubIssueAdoptionResult } from "../../main/services/GithubIssueAdoptionService";
import type {
  GithubIssueOverlayInput,
  GithubIssueOverlayResult,
} from "../../main/services/GithubIssueOverlayService";
import type {
  GithubIssueCommentRow as MainGithubIssueCommentRow,
  GithubIssueEventRow as MainGithubIssueEventRow,
  GithubIssueListFilters as MainGithubIssueListFilters,
  GithubIssueRow as MainGithubIssueRow,
} from "../../main/services/GithubIssuesStore";

export type GithubIssueRow = MainGithubIssueRow;
export type GithubIssueCommentRow = MainGithubIssueCommentRow;
export type GithubIssueEventRow = MainGithubIssueEventRow;
export type GithubIssueListFilters = MainGithubIssueListFilters;
export type GithubIssueRefreshOptions = GithubIssueListOptions;
export type { GithubIssueAdoptionResult };
export type { GithubIssueOverlayResult };

export interface GithubIssueResnapshotResult {
  id: string;
  urn: string;
  titleUpdated: boolean;
  statusUpdated: boolean;
  bodyChanged: boolean;
}

interface IPCResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
}

function api(): NonNullable<typeof window.electronAPI> {
  if (!window.electronAPI) throw new Error("electronAPI not available");
  return window.electronAPI;
}

function unwrap<T>(response: IPCResponse<T>, channel: string): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.error || `${channel} failed`);
  }
  return response.data;
}

export class RendererGithubIssueService {
  async list(
    workspacePath: string,
    remote: string,
    filters?: GithubIssueListFilters
  ): Promise<GithubIssueRow[]> {
    return unwrap(
      await api().invoke("issue:list", workspacePath, remote, filters),
      "issue:list"
    );
  }

  async get(
    workspacePath: string,
    remote: string,
    number: number
  ): Promise<GithubIssueRow> {
    return unwrap(
      await api().invoke("issue:get", workspacePath, remote, number),
      "issue:get"
    );
  }

  async comments(
    workspacePath: string,
    remote: string,
    number: number
  ): Promise<GithubIssueCommentRow[]> {
    return unwrap(
      await api().invoke("issue:comments", workspacePath, remote, number),
      "issue:comments"
    );
  }

  async timeline(
    workspacePath: string,
    remote: string,
    number: number
  ): Promise<GithubIssueEventRow[]> {
    return unwrap(
      await api().invoke("issue:timeline", workspacePath, remote, number),
      "issue:timeline"
    );
  }

  async comment(
    workspacePath: string,
    remote: string,
    number: number,
    body: string
  ): Promise<GithubIssueCommentRow> {
    return unwrap(
      await api().invoke("issue:comment", workspacePath, remote, number, body),
      "issue:comment"
    );
  }

  async setState(
    workspacePath: string,
    remote: string,
    number: number,
    state: "open" | "closed"
  ): Promise<GithubIssueRow> {
    return unwrap(
      await api().invoke(
        "issue:set-state",
        workspacePath,
        remote,
        number,
        state
      ),
      "issue:set-state"
    );
  }

  async refresh(
    workspacePath: string,
    remote: string,
    options: GithubIssueRefreshOptions = { state: "all" }
  ): Promise<GithubIssueRow[]> {
    return unwrap(
      await api().invoke("issue:refresh", workspacePath, remote, options),
      "issue:refresh"
    );
  }

  async pollNow(workspacePath: string): Promise<void> {
    unwrap(
      await api().invoke("issue:poll-now", workspacePath),
      "issue:poll-now"
    );
  }

  async adopt(
    workspacePath: string,
    remote: string,
    number: number,
    options: { primaryType?: string } = {}
  ): Promise<GithubIssueAdoptionResult> {
    return unwrap(
      await api().invoke("issue:adopt", workspacePath, remote, number, options),
      "issue:adopt"
    );
  }

  async getOrCreateOverlay(
    workspacePath: string,
    input: Omit<GithubIssueOverlayInput, "workspacePath">
  ): Promise<GithubIssueOverlayResult> {
    return unwrap(
      await api().invoke("issue:overlay-get-or-create", workspacePath, input),
      "issue:overlay-get-or-create"
    );
  }

  /** Existing importer reconciliation path; tracker notifications refresh the local record. */
  async resnapshot(
    workspacePath: string,
    urn: string
  ): Promise<GithubIssueResnapshotResult> {
    return api().invoke("tracker:importer:resnapshot", { workspacePath, urn });
  }
}

let instance: RendererGithubIssueService | null = null;

export function getGithubIssueService(): RendererGithubIssueService {
  if (!instance) {
    instance = new RendererGithubIssueService();
  }
  return instance;
}
