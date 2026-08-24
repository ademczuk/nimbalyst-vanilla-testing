import { BrowserWindow } from "electron";
import log from "electron-log/main";
import type { GithubIssueListOptions } from "../services/GhApiService.issues";
import type {
  GithubIssueCommentRow,
  GithubIssueEventRow,
  GithubIssueListFilters,
  GithubIssueRow,
} from "../services/GithubIssuesStore";
import {
  getGithubApiService,
  getGithubIssuesStore,
  getGithubPollScheduler,
} from "../services/GithubServices";
import {
  getGithubIssueAdoptionService,
  type GithubIssueAdoptionResult,
} from "../services/GithubIssueAdoptionService";
import {
  getGithubIssueOverlayService,
  type GithubIssueOverlayInput,
  type GithubIssueOverlayResult,
} from "../services/GithubIssueOverlayService";
import {
  assertGithubIssueNumber,
  assertGithubIssueState,
  assertGithubWritableIssueState,
  assertGithubRemote,
  assertWorkspacePath,
} from "../services/ghApiHelpers";
import { safeHandle } from "../utils/ipcRegistry";
import { ghErrorResponse, type IPCResponse } from "./githubIpcErrors";

const logger = log.scope("GithubIssueHandlers");

function emitIssueListUpdated(workspacePath: string, remote: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("issue:list-updated", { workspacePath, remote });
    }
  }
}

function validateRoute(
  workspacePath: string,
  remote: string,
  number?: number
): void {
  assertWorkspacePath(workspacePath);
  assertGithubRemote(remote);
  if (number !== undefined) assertGithubIssueNumber(number);
}

export function registerGithubIssueHandlers(): void {
  safeHandle(
    "issue:list",
    async (
      _event,
      workspacePath: string,
      remote: string,
      filters: GithubIssueListFilters = {}
    ): Promise<IPCResponse<GithubIssueRow[]>> => {
      try {
        validateRoute(workspacePath, remote);
        if (filters.state) assertGithubIssueState(filters.state);
        const rows = await getGithubIssuesStore().list(
          workspacePath,
          remote,
          filters
        );
        return { success: true, data: rows };
      } catch (error) {
        logger.error("issue:list failed", { workspacePath, remote, error });
        return ghErrorResponse(error);
      }
    }
  );

  safeHandle(
    "issue:get",
    async (
      _event,
      workspacePath: string,
      remote: string,
      number: number
    ): Promise<IPCResponse<GithubIssueRow>> => {
      try {
        validateRoute(workspacePath, remote, number);
        const row = await getGithubApiService().getIssue(
          workspacePath,
          remote,
          number
        );
        return { success: true, data: row };
      } catch (error) {
        logger.error("issue:get failed", {
          workspacePath,
          remote,
          number,
          error,
        });
        return ghErrorResponse(error);
      }
    }
  );

  safeHandle(
    "issue:comments",
    async (
      _event,
      workspacePath: string,
      remote: string,
      number: number
    ): Promise<IPCResponse<GithubIssueCommentRow[]>> => {
      try {
        validateRoute(workspacePath, remote, number);
        const rows = await getGithubApiService().getIssueComments(
          workspacePath,
          remote,
          number
        );
        return { success: true, data: rows };
      } catch (error) {
        logger.error("issue:comments failed", {
          workspacePath,
          remote,
          number,
          error,
        });
        return ghErrorResponse(error);
      }
    }
  );

  safeHandle(
    "issue:timeline",
    async (
      _event,
      workspacePath: string,
      remote: string,
      number: number
    ): Promise<IPCResponse<GithubIssueEventRow[]>> => {
      try {
        validateRoute(workspacePath, remote, number);
        const rows = await getGithubApiService().getIssueTimeline(
          workspacePath,
          remote,
          number
        );
        return { success: true, data: rows };
      } catch (error) {
        logger.error("issue:timeline failed", {
          workspacePath,
          remote,
          number,
          error,
        });
        return ghErrorResponse(error);
      }
    }
  );

  safeHandle(
    "issue:comment",
    async (
      _event,
      workspacePath: string,
      remote: string,
      number: number,
      body: string
    ): Promise<IPCResponse<GithubIssueCommentRow>> => {
      try {
        validateRoute(workspacePath, remote, number);
        const row = await getGithubApiService().commentOnIssue(
          workspacePath,
          remote,
          number,
          body
        );
        emitIssueListUpdated(workspacePath, remote);
        return { success: true, data: row };
      } catch (error) {
        logger.error("issue:comment failed", {
          workspacePath,
          remote,
          number,
          error,
        });
        return ghErrorResponse(error);
      }
    }
  );

  safeHandle(
    "issue:set-state",
    async (
      _event,
      workspacePath: string,
      remote: string,
      number: number,
      state: unknown
    ): Promise<IPCResponse<GithubIssueRow>> => {
      try {
        validateRoute(workspacePath, remote, number);
        assertGithubWritableIssueState(state);
        const row = await getGithubApiService().setIssueState(
          workspacePath,
          remote,
          number,
          state
        );
        emitIssueListUpdated(workspacePath, remote);
        return { success: true, data: row };
      } catch (error) {
        logger.error("issue:set-state failed", {
          workspacePath,
          remote,
          number,
          state,
          error,
        });
        return ghErrorResponse(error);
      }
    }
  );

  safeHandle(
    "issue:refresh",
    async (
      _event,
      workspacePath: string,
      remote: string,
      options: GithubIssueListOptions = { state: "all" }
    ): Promise<IPCResponse<GithubIssueRow[]>> => {
      try {
        validateRoute(workspacePath, remote);
        const rows = await getGithubApiService().listIssues(
          workspacePath,
          remote,
          options
        );
        emitIssueListUpdated(workspacePath, remote);
        return { success: true, data: rows };
      } catch (error) {
        logger.error("issue:refresh failed", { workspacePath, remote, error });
        return ghErrorResponse(error);
      }
    }
  );

  safeHandle(
    "issue:poll-now",
    async (
      _event,
      workspacePath: string
    ): Promise<IPCResponse<{ ok: boolean }>> => {
      try {
        assertWorkspacePath(workspacePath);
        await getGithubPollScheduler().pollNow(workspacePath);
        return { success: true, data: { ok: true } };
      } catch (error) {
        logger.error("issue:poll-now failed", { workspacePath, error });
        return ghErrorResponse(error);
      }
    }
  );

  safeHandle(
    "issue:overlay-get-or-create",
    async (
      _event,
      workspacePath: string,
      input: Omit<GithubIssueOverlayInput, "workspacePath">
    ): Promise<IPCResponse<GithubIssueOverlayResult>> => {
      try {
        assertWorkspacePath(workspacePath);
        if (!input || typeof input !== "object") {
          throw new Error("issue:overlay-get-or-create input required");
        }
        const result = await getGithubIssueOverlayService().getOrCreate({
          ...input,
          workspacePath,
        });
        return { success: true, data: result };
      } catch (error) {
        logger.error("issue:overlay-get-or-create failed", { workspacePath, error });
        return ghErrorResponse(error);
      }
    }
  );

  safeHandle(
    "issue:adopt",
    async (
      _event,
      workspacePath: string,
      remote: string,
      number: number,
      options: { primaryType?: unknown } = {}
    ): Promise<IPCResponse<GithubIssueAdoptionResult>> => {
      try {
        validateRoute(workspacePath, remote, number);
        const primaryType = options.primaryType;
        if (
          primaryType !== undefined &&
          (typeof primaryType !== "string" || primaryType.trim().length === 0)
        ) {
          throw new Error("issue:adopt primaryType must be a non-empty string");
        }
        const result = await getGithubIssueAdoptionService().adopt({
          workspacePath,
          remote,
          number,
          primaryType:
            typeof primaryType === "string" ? primaryType.trim() : undefined,
        });
        emitIssueListUpdated(workspacePath, remote);
        return { success: true, data: result };
      } catch (error) {
        logger.error("issue:adopt failed", {
          workspacePath,
          remote,
          number,
          error,
        });
        return ghErrorResponse(error);
      }
    }
  );
}
