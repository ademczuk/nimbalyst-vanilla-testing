/**
 * Explicit one-way escalation from a GitHub issue to a real tracker item.
 *
 * Importing remains wholly owned by TrackerImportService. This coordinator only
 * makes the thin github-issue overlay point at the import after that import has
 * succeeded.
 */

import { getDatabase } from "../database/initialize";
import {
  handleTrackerCreate,
  handleTrackerUpdate,
} from "../mcp/tools/trackerToolHandlers";
import {
  getTrackerImportService,
  type RunImportResult,
} from "./tracker/TrackerImportService";
import { getGithubApiService, getGithubIssuesStore } from "./GithubServices";
import {
  assertGithubIssueNumber,
  assertGithubRemote,
  assertWorkspacePath,
} from "./ghApiHelpers";

const GITHUB_ISSUES_PROVIDER_ID = "github-issues";

export interface GithubIssueAdoptionArgs {
  workspacePath: string;
  remote: string;
  number: number;
  primaryType?: string;
}

export interface GithubIssueAdoptionResult {
  adoptedItemId: string;
  overlayItemId: string;
  urn: string;
  importCreated: boolean;
  overlayCreated: boolean;
}

export interface GithubIssueOverlay {
  id: string;
  status?: string;
  adoptedItemId?: string;
}

interface GithubIssueOverlayCreateArgs extends GithubIssueAdoptionArgs {
  title: string;
  authorLogin: string | null;
  issueUrl: string;
  adoptedItemId: string;
}

export interface GithubIssueAdoptionDependencies {
  findOverlay(
    workspacePath: string,
    remote: string,
    number: number
  ): Promise<GithubIssueOverlay | null>;
  runImport(args: {
    workspacePath: string;
    providerId: string;
    externalId: string;
    primaryType?: string;
  }): Promise<RunImportResult>;
  loadIssueMetadata(
    workspacePath: string,
    remote: string,
    number: number
  ): Promise<{ title: string; authorLogin: string | null; issueUrl: string }>;
  createAdoptedOverlay(args: GithubIssueOverlayCreateArgs): Promise<string>;
  markOverlayAdopted(
    workspacePath: string,
    overlayId: string,
    adoptedItemId: string
  ): Promise<void>;
}

type TrackerRow = { id: string; data: unknown };

function parseTrackerData(value: unknown): Record<string, unknown> {
  if (typeof value === "string")
    return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object")
    return value as Record<string, unknown>;
  return {};
}

function storedField(data: Record<string, unknown>, key: string): unknown {
  if (data[key] !== undefined) return data[key];
  const customFields = data.customFields;
  if (
    customFields &&
    typeof customFields === "object" &&
    !Array.isArray(customFields)
  ) {
    return (customFields as Record<string, unknown>)[key];
  }
  return undefined;
}

function urlString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { url?: unknown }).url === "string"
  ) {
    return (value as { url: string }).url;
  }
  return null;
}

function matchesIssue(
  data: Record<string, unknown>,
  remote: string,
  number: number
): boolean {
  const storedRemote = storedField(data, "repo");
  const storedNumber = Number(storedField(data, "issueNumber"));
  if (
    typeof storedRemote === "string" &&
    storedRemote.toLowerCase() === remote.toLowerCase() &&
    storedNumber === number
  ) {
    return true;
  }

  const issueUrl = urlString(storedField(data, "issueUrl"));
  if (!issueUrl) return false;
  try {
    const parsed = new URL(issueUrl);
    const parts = parsed.pathname
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean);
    return (
      parsed.hostname.toLowerCase() === "github.com" &&
      parts.length === 4 &&
      `${parts[0]}/${parts[1]}`.toLowerCase() === remote.toLowerCase() &&
      parts[2].toLowerCase() === "issues" &&
      Number(parts[3]) === number
    );
  } catch {
    return false;
  }
}

async function findOverlay(
  workspacePath: string,
  remote: string,
  number: number
): Promise<GithubIssueOverlay | null> {
  const { rows } = await getDatabase().query<TrackerRow>(
    `SELECT id, data FROM tracker_items
      WHERE workspace = $1 AND type = 'github-issue' AND archived = FALSE`,
    [workspacePath]
  );
  for (const row of rows) {
    const data = parseTrackerData(row.data);
    if (!matchesIssue(data, remote, number)) continue;
    const status = storedField(data, "status");
    const adoptedItemId = storedField(data, "adoptedItemId");
    return {
      id: row.id,
      status: typeof status === "string" ? status : undefined,
      adoptedItemId:
        typeof adoptedItemId === "string" ? adoptedItemId : undefined,
    };
  }
  return null;
}

function trackerMutationError(
  action: string,
  result: Awaited<ReturnType<typeof handleTrackerUpdate>>
): Error {
  const text = result.content?.[0]?.text ?? "unknown error";
  return new Error(`${action} failed: ${text}`);
}

const defaultDependencies: GithubIssueAdoptionDependencies = {
  findOverlay,
  runImport: (args) => getTrackerImportService().runImport(args),
  loadIssueMetadata: async (workspacePath, remote, number) => {
    const cached = await getGithubIssuesStore().getByNumber(
      workspacePath,
      remote,
      number
    );
    const issue =
      cached ??
      (await getGithubApiService().getIssue(workspacePath, remote, number));
    return {
      title: issue.title,
      authorLogin: issue.authorLogin,
      issueUrl: issue.htmlUrl,
    };
  },
  createAdoptedOverlay: async (args) => {
    const result = await handleTrackerCreate(
      {
        type: "github-issue",
        title: args.title,
        status: "adopted",
        createdByAgent: false,
        fields: {
          issueUrl: args.issueUrl,
          issueNumber: args.number,
          author: args.authorLogin ?? "",
          repo: args.remote,
          adoptedItemId: args.adoptedItemId,
        },
      },
      args.workspacePath
    );
    if (result.isError)
      throw trackerMutationError("Creating GitHub issue overlay", result);
    const overlay = await findOverlay(
      args.workspacePath,
      args.remote,
      args.number
    );
    if (!overlay)
      throw new Error("GitHub issue overlay was not readable after creation");
    return overlay.id;
  },
  markOverlayAdopted: async (workspacePath, overlayId, adoptedItemId) => {
    const result = await handleTrackerUpdate(
      { id: overlayId, status: "adopted", fields: { adoptedItemId } },
      workspacePath
    );
    if (result.isError)
      throw trackerMutationError("Updating GitHub issue overlay", result);
  },
};

export class GithubIssueAdoptionService {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dependencies: GithubIssueAdoptionDependencies = defaultDependencies
  ) {}

  private async withIssueLock<T>(
    key: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  async adopt(
    args: GithubIssueAdoptionArgs
  ): Promise<GithubIssueAdoptionResult> {
    assertWorkspacePath(args.workspacePath);
    assertGithubRemote(args.remote);
    assertGithubIssueNumber(args.number);
    const externalId = `${args.remote}#${args.number}`;
    const urn = `github://${externalId}`;
    const lockKey = `${args.workspacePath}\u0000${externalId}`;

    return this.withIssueLock(lockKey, async () => {
      const existingOverlay = await this.dependencies.findOverlay(
        args.workspacePath,
        args.remote,
        args.number
      );
      if (existingOverlay?.adoptedItemId) {
        if (existingOverlay.status !== "adopted") {
          await this.dependencies.markOverlayAdopted(
            args.workspacePath,
            existingOverlay.id,
            existingOverlay.adoptedItemId
          );
        }
        return {
          adoptedItemId: existingOverlay.adoptedItemId,
          overlayItemId: existingOverlay.id,
          urn,
          importCreated: false,
          overlayCreated: false,
        };
      }

      const imported = await this.dependencies.runImport({
        workspacePath: args.workspacePath,
        providerId: GITHUB_ISSUES_PROVIDER_ID,
        externalId,
        primaryType: args.primaryType,
      });

      const overlayAfterImport = await this.dependencies.findOverlay(
        args.workspacePath,
        args.remote,
        args.number
      );
      if (overlayAfterImport) {
        await this.dependencies.markOverlayAdopted(
          args.workspacePath,
          overlayAfterImport.id,
          imported.id
        );
        return {
          adoptedItemId: imported.id,
          overlayItemId: overlayAfterImport.id,
          urn: imported.urn,
          importCreated: imported.created,
          overlayCreated: false,
        };
      }

      const metadata = await this.dependencies.loadIssueMetadata(
        args.workspacePath,
        args.remote,
        args.number
      );
      const overlayItemId = await this.dependencies.createAdoptedOverlay({
        ...args,
        ...metadata,
        adoptedItemId: imported.id,
      });
      return {
        adoptedItemId: imported.id,
        overlayItemId,
        urn: imported.urn,
        importCreated: imported.created,
        overlayCreated: true,
      };
    });
  }
}

let adoptionService: GithubIssueAdoptionService | null = null;

export function getGithubIssueAdoptionService(): GithubIssueAdoptionService {
  if (!adoptionService) adoptionService = new GithubIssueAdoptionService();
  return adoptionService;
}
