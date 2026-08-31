/**
 * Promoting a whole local folder to the team.
 *
 * "Share to Team" was single-file by signature, so sharing a project area meant
 * right-clicking every file in it and re-picking the destination each time. This
 * is the batch shape: ask once, then publish N files into a mirrored folder tree
 * and report one summary instead of N toasts.
 *
 * Three things here are not obvious from the single-file flow next door:
 *
 * - **Only folders that hold something shareable get mirrored.** Mirroring the
 *   whole local tree would put empty folders in the team space that nobody
 *   asked for and nobody can fill from here.
 * - **Embeds are discovered once, then ordered.** A file that embeds another
 *   file in the same folder has to be shared *after* it, or the embed cascade
 *   creates a second copy of a document this batch is already publishing. The
 *   order comes from a topological sort of the in-batch embed graph; a cycle
 *   just falls back to input order and the leftover link stays local.
 * - **A promote is a one-time copy.** The shared folder does not track the local
 *   one, so a file added locally afterwards is not published. Live folder
 *   linking is its own feature and is deliberately not started here.
 */

import { store } from "@nimbalyst/runtime/store";
import { DIALOG_IDS, dialogRef } from "../dialogs";
import type { ShareFolderToTeamData } from "../dialogs";
import {
  activeTeamOrgIdAtom,
  resolveDesktopCollabScope,
} from "../store/atoms/collabDocuments";
import { activeWorkspacePathAtom } from "../store/atoms/openProjects";
import { getRelativePath } from "../utils/pathUtils";
import { joinCollabPath, normalizeCollabPath } from "../components/CollabMode/collabTree";
import type { EmbeddedDocumentCandidate } from "./embeddedDocumentShare";
import {
  collectFolderShareCandidates,
  MAX_FOLDER_SHARE_DOCUMENTS,
  type FolderShareCandidateSet,
} from "./folderShareCandidates";
import {
  orderCandidatesByEmbedDependency,
  reportFolderShareOutcome,
} from "./folderSharePlan";
import { ensureSharedFolderSegments } from "./sharedFolderPath";
import {
  discoverShareEmbeddedDocuments,
  resolveShareDescriptor,
  shareFileToTeam,
} from "./shareToTeamFlow";

export interface ShareFolderToTeamTarget {
  folderPath: string;
  folderName: string;
}

export interface ShareFolderToTeamAnswers {
  /** Destination folder in the team tree; `null` is the team root. */
  folderId: string | null;
  folderPath: string;
  /** Name of the shared folder this promote creates under the destination. */
  sharedFolderName: string;
}

export type ShareFolderToTeamAsk =
  | { status: "answered"; answers: ShareFolderToTeamAnswers }
  | { status: "cancelled" }
  | { status: "unavailable"; reason: string };

export interface ShareFolderToTeamResult {
  sharedCount: number;
  /** Files that had no collaborative document type, plus the reason each time. */
  skippedCount: number;
  failures: Array<{ relativePath: string; error: string }>;
  warnings: string[];
  sharedFolderPath: string;
}

/**
 * Every file under `folderPath`, split into what can be promoted and what
 * cannot. Runs before the dialog opens so the author is told the counts up
 * front rather than discovering them in a summary afterwards.
 */
export async function collectFolderShareTargets(
  folderPath: string
): Promise<{ set: FolderShareCandidateSet; truncated: boolean }> {
  const listing = await window.electronAPI?.getFolderFilesRecursive?.(folderPath);
  const files = listing?.files ?? [];
  return {
    set: collectFolderShareCandidates(files, resolveShareDescriptor),
    truncated: listing?.truncated === true,
  };
}

export async function askShareFolderToTeam(
  target: ShareFolderToTeamTarget,
  candidateSet: FolderShareCandidateSet,
  options: { truncated?: boolean } = {}
): Promise<ShareFolderToTeamAsk> {
  const dialogs = dialogRef.current;
  if (!dialogs) {
    return {
      status: "unavailable",
      reason: "The share dialog is not available in this window.",
    };
  }

  const workspacePath = store.get(activeWorkspacePathAtom);
  const sourceRelPath = workspacePath
    ? getRelativePath(workspacePath, target.folderPath) || target.folderName
    : target.folderName;

  return new Promise<ShareFolderToTeamAsk>((resolve) => {
    let answered = false;
    dialogs.open<ShareFolderToTeamData>(DIALOG_IDS.SHARE_FOLDER_TO_TEAM, {
      folderName: target.folderName,
      sourceRelPath,
      candidateCount: candidateSet.candidates.length,
      skipped: candidateSet.skipped,
      subfolderCount: candidateSet.subfolderPaths.length,
      truncated: options.truncated === true,
      onConfirm: (answers) => {
        answered = true;
        resolve({ status: "answered", answers });
      },
      // Same contract as the single-file dialog: closing is not an answer.
      onDismiss: () => {
        if (!answered) resolve({ status: "cancelled" });
      },
    });
  });
}

function joinFolderPath(folderPath: string, relativePath: string): string {
  return relativePath ? `${folderPath}/${relativePath}` : folderPath;
}

export async function shareFolderToTeam(params: {
  target: ShareFolderToTeamTarget;
  candidateSet: FolderShareCandidateSet;
  answers: ShareFolderToTeamAnswers;
}): Promise<ShareFolderToTeamResult | { status: "failed"; error: string }> {
  const { target, candidateSet, answers } = params;
  const { errorNotificationService } = await import("./ErrorNotificationService");

  // The dialog disables its button past the cap; this is the same rule where it
  // cannot be routed around, because publishing the first 100 of 340 is the one
  // outcome this feature must never produce silently.
  if (candidateSet.candidates.length > MAX_FOLDER_SHARE_DOCUMENTS) {
    const error = `"${target.folderName}" holds ${candidateSet.candidates.length} shareable documents, more than the ${MAX_FOLDER_SHARE_DOCUMENTS} one promote can publish. Share its subfolders separately.`;
    errorNotificationService.showError("Folder is too large to share", error, {
      duration: 10000,
    });
    return { status: "failed", error };
  }

  const workspacePath = store.get(activeWorkspacePathAtom);
  const scope = workspacePath
    ? (await resolveDesktopCollabScope(workspacePath)).scope
    : null;
  if (!scope) {
    const error = "The active team collaboration scope is unavailable.";
    errorNotificationService.showError("Could not share folder to team", error);
    return { status: "failed", error };
  }

  const sharedFolderName = answers.sharedFolderName.trim() || target.folderName;
  const sharedFolderPath = joinCollabPath(
    normalizeCollabPath(answers.folderPath),
    sharedFolderName
  );

  // The mirrored tree first: every file needs its destination to exist before
  // it is created, and a half-built tree is easier to reason about than a
  // half-placed set of documents.
  let rootFolderId: string | null;
  const folderIdByRelativePath = new Map<string, string | null>();
  try {
    rootFolderId = await ensureSharedFolderSegments(
      scope,
      [sharedFolderName],
      answers.folderId
    );
    folderIdByRelativePath.set("", rootFolderId);
    for (const subfolderPath of candidateSet.subfolderPaths) {
      const segments = subfolderPath.split("/");
      const parentPath = segments.slice(0, -1).join("/");
      const parentId = folderIdByRelativePath.get(parentPath) ?? rootFolderId;
      folderIdByRelativePath.set(
        subfolderPath,
        await ensureSharedFolderSegments(scope, [segments[segments.length - 1]], parentId)
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorNotificationService.showError(
      "Could not share folder to team",
      `The shared folder tree could not be created: ${message}`
    );
    return { status: "failed", error: message };
  }

  // One discovery pass per file. Its results are reused at share time with
  // `alreadyShared` patched in from what this batch has published so far, so a
  // file embedded by a sibling is linked rather than copied a second time.
  const embedsByRelativePath = new Map<string, EmbeddedDocumentCandidate[]>();
  const inBatchDependencies = new Map<string, Set<string>>();
  const relativePathByAbsolutePath = new Map<string, string>();
  for (const candidate of candidateSet.candidates) {
    relativePathByAbsolutePath.set(
      joinFolderPath(target.folderPath, candidate.relativePath),
      candidate.relativePath
    );
  }
  for (const candidate of candidateSet.candidates) {
    if (
      candidate.descriptor.documentType !== "markdown" &&
      candidate.descriptor.documentType !== "canvas"
    ) {
      continue;
    }
    const embeds = await discoverShareEmbeddedDocuments(
      joinFolderPath(target.folderPath, candidate.relativePath),
      candidate.descriptor
    );
    if (embeds.length === 0) continue;
    embedsByRelativePath.set(candidate.relativePath, embeds);
    const dependencies = new Set<string>();
    for (const embed of embeds) {
      const dependencyRelativePath = relativePathByAbsolutePath.get(embed.absolutePath);
      if (dependencyRelativePath) dependencies.add(dependencyRelativePath);
    }
    if (dependencies.size > 0) {
      inBatchDependencies.set(candidate.relativePath, dependencies);
    }
  }

  const orgId = store.get(activeTeamOrgIdAtom) ?? scope.orgId;
  const ordered = orderCandidatesByEmbedDependency(
    candidateSet.candidates,
    inBatchDependencies
  );

  const sharedByAbsolutePath = new Map<string, { documentId: string; orgId: string }>();
  const failures: Array<{ relativePath: string; error: string }> = [];
  const warnings: string[] = [];
  let unresolvedInBatchLinks = 0;

  for (const candidate of ordered) {
    const absolutePath = joinFolderPath(target.folderPath, candidate.relativePath);
    const discovered = embedsByRelativePath.get(candidate.relativePath) ?? [];
    const embeddedDocuments: EmbeddedDocumentCandidate[] = [];
    const selectedEmbeddedDocumentPaths: string[] = [];
    for (const embed of discovered) {
      const publishedInBatch = sharedByAbsolutePath.get(embed.absolutePath);
      const inBatch = relativePathByAbsolutePath.has(embed.absolutePath);
      if (inBatch && !publishedInBatch && !embed.alreadyShared) {
        // Only reachable through an embed cycle. Letting the cascade run would
        // publish a second copy of a file this batch already owns.
        unresolvedInBatchLinks += 1;
        continue;
      }
      embeddedDocuments.push(
        publishedInBatch ? { ...embed, alreadyShared: publishedInBatch } : embed
      );
      selectedEmbeddedDocumentPaths.push(embed.absolutePath);
    }

    const result = await shareFileToTeam({
      filePath: absolutePath,
      fileName: candidate.fileName,
      answers: {
        descriptor: candidate.descriptor,
        folderId: folderIdByRelativePath.get(candidate.parentRelativePath) ?? rootFolderId,
        folderPath: joinCollabPath(sharedFolderPath, candidate.parentRelativePath),
        sharedName: candidate.fileName,
        embeddedDocuments,
        selectedEmbeddedDocumentPaths,
      },
      openAfterCreate: false,
      persistLastSharedFolder: false,
      showNotifications: false,
    });

    if (result.status === "shared") {
      sharedByAbsolutePath.set(absolutePath, {
        documentId: result.documentId,
        orgId: result.orgId || orgId,
      });
      if (result.warnings?.length) {
        warnings.push(`${candidate.relativePath}: ${result.warnings.join(", ")}`);
      }
    } else {
      failures.push({ relativePath: candidate.relativePath, error: result.error });
    }
  }

  if (unresolvedInBatchLinks > 0) {
    warnings.push(
      `${unresolvedInBatchLinks} embedded link${
        unresolvedInBatchLinks === 1 ? "" : "s"
      } between files in this folder stayed local (the files embed each other).`
    );
  }

  // The destination is recorded once for the whole promote, not once per file.
  if (workspacePath && window.electronAPI?.invoke) {
    window.electronAPI
      .invoke("workspace:update-state", workspacePath, {
        collabTree: {
          lastSharedFolderId: answers.folderId,
          lastSharedFolder: normalizeCollabPath(answers.folderPath),
        },
      })
      .catch((error: unknown) => {
        console.warn(
          "[shareFolderToTeamFlow] Failed to persist lastSharedFolder:",
          error
        );
      });
  }

  const sharedCount = sharedByAbsolutePath.size;
  const skippedCount = candidateSet.skipped.length;
  reportFolderShareOutcome({
    folderName: target.folderName,
    sharedFolderPath,
    sharedCount,
    skippedCount,
    failures,
    warnings,
    skipped: candidateSet.skipped,
    showError: errorNotificationService.showError.bind(errorNotificationService),
    showWarning: errorNotificationService.showWarning.bind(errorNotificationService),
    showInfo: errorNotificationService.showInfo.bind(errorNotificationService),
  });

  return {
    sharedCount,
    skippedCount,
    failures,
    warnings,
    sharedFolderPath,
  };
}

export async function shareFolderToTeamFromContextMenu(
  target: ShareFolderToTeamTarget
): Promise<void> {
  const { errorNotificationService } = await import("./ErrorNotificationService");
  let collected: Awaited<ReturnType<typeof collectFolderShareTargets>>;
  try {
    collected = await collectFolderShareTargets(target.folderPath);
  } catch (error) {
    errorNotificationService.showError(
      "Could not share folder to team",
      `"${target.folderName}" could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return;
  }

  if (collected.set.candidates.length === 0) {
    errorNotificationService.showWarning(
      "Nothing to share",
      `No file in "${target.folderName}" has a collaborative document type.`,
      { duration: 6000 }
    );
    return;
  }

  const ask = await askShareFolderToTeam(target, collected.set, {
    truncated: collected.truncated,
  });
  if (ask.status === "unavailable") {
    errorNotificationService.showError("Could not share folder to team", ask.reason);
    return;
  }
  if (ask.status !== "answered") return;

  await shareFolderToTeam({
    target,
    candidateSet: collected.set,
    answers: ask.answers,
  });
}
