/**
 * Whether the team the invitation goes to already has something to open.
 *
 * The invite dialog's folder picker exists for one case: a teammate accepting
 * into an empty space. Recommending a publish to someone whose team already
 * has shared content is advice they have already taken, so the dialog has to
 * know the difference before it says anything.
 *
 * The answer is deliberately three-valued. The shared-document list only fills
 * once a documents session has been started for the scope, and Settings is a
 * surface that never starts one on its own -- reading the list cold would
 * report "empty" for a team with hundreds of documents, which is the exact
 * wrong claim this hook exists to prevent. `unknown` covers everything before
 * a started session has answered, and the list atom is reactive, so documents
 * that arrive after the dialog opened still move it off that default.
 */

import { useEffect, useMemo, useState } from 'react';
import { atom, useAtomValue } from 'jotai';
import { sharedDocumentsForScopeAtom } from '@nimbalyst/collab-client/docs';
import { initSharedDocuments, resolveDesktopCollabScope } from '../../store/atoms/collabDocuments';

export type TeamSharedContent = 'unknown' | 'empty' | 'has-content';

const NO_DOCUMENTS = atom<[]>([]);

/**
 * The scope key of a desktop documents session is the workspace path, so a
 * dialog holding a workspace path can start and read one without threading a
 * scope through its props.
 */
export function useTeamSharedContent(
  workspacePath: string | null,
  enabled: boolean,
): TeamSharedContent {
  // The scope whose session answered, so a stale answer from a previous
  // workspace never speaks for the current one.
  const [answeredFor, setAnsweredFor] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !workspacePath) return;
    let cancelled = false;
    void resolveDesktopCollabScope(workspacePath)
      .then(async ({ scope }) => {
        if (cancelled || !scope) return;
        await initSharedDocuments(scope);
        if (!cancelled) setAnsweredFor(workspacePath);
      })
      .catch((error: unknown) => {
        // A session that cannot start leaves the answer at `unknown`, which is
        // the honest state: the dialog then neither pushes nor suppresses.
        console.warn("[InviteToTeamDialog] could not read the team's shared documents", error);
      });
    return () => { cancelled = true; };
  }, [enabled, workspacePath]);

  const documentsAtom = useMemo(
    () => (workspacePath ? sharedDocumentsForScopeAtom(workspacePath) : NO_DOCUMENTS),
    [workspacePath],
  );
  const documents = useAtomValue(documentsAtom);

  if (!enabled || !workspacePath) return 'unknown';
  // Documents already in hand answer the question whether or not the session
  // has reported in; only their absence has to wait for it.
  if (documents.length > 0) return 'has-content';
  return answeredFor === workspacePath ? 'empty' : 'unknown';
}
