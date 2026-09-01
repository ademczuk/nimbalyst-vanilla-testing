/**
 * Publishing the folders an invitation promised.
 *
 * Reuses `shareFolderToTeam` rather than reimplementing a batch share: that
 * flow already handles embed ordering, the document cap, asset migration, and
 * the mirrored folder tree. This only decides *where* each folder lands and
 * turns N outcomes into one summary.
 *
 * Every folder goes to the team root under its own name. Asking the inviter to
 * choose a destination per folder would put a second placement decision inside
 * a dialog whose subject is a person, and the team root is the destination
 * they can most easily move things out of afterwards.
 */

export interface PublishFoldersOutcome {
  published: number;
  /** Folder names that could not be published, with the reason attached. */
  failures: string[];
}

function folderName(folderPath: string): string {
  const segments = folderPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? folderPath;
}

export async function publishFoldersForInvite(
  folderPaths: readonly string[],
): Promise<PublishFoldersOutcome> {
  const { collectFolderShareTargets, shareFolderToTeam } = await import(
    '../../services/shareFolderToTeamFlow'
  );

  let published = 0;
  const failures: string[] = [];

  for (const folderPath of folderPaths) {
    const name = folderName(folderPath);
    try {
      const collected = await collectFolderShareTargets(folderPath);
      if (collected.set.candidates.length === 0) {
        // Not a failure worth alarming anyone about, but not a success either:
        // reporting it as published would inflate the count the inviter reads.
        failures.push(`${name} (nothing shareable in it)`);
        continue;
      }
      const result = await shareFolderToTeam({
        target: { folderPath, folderName: name },
        candidateSet: collected.set,
        answers: { folderId: null, folderPath: '', sharedFolderName: name },
      });
      if ('status' in result) {
        failures.push(`${name} (${result.error})`);
        continue;
      }
      published += 1;
      for (const failure of result.failures) {
        failures.push(`${name}/${failure.relativePath} (${failure.error})`);
      }
    } catch (reason) {
      failures.push(`${name} (${reason instanceof Error ? reason.message : String(reason)})`);
    }
  }

  return { published, failures };
}
