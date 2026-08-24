import { useCallback, useEffect, useState } from 'react';
import { parseUnifiedDiffToHunks } from '../../../../git/unifiedDiffModel';
import {
  buildFileHunkState,
  buildSessionEditSignature,
  withAllHunksSelected,
  withHunkToggled,
  type FileHunkState,
  type SessionEditSignature,
} from './selectionModel';

interface HunkSelectionHost {
  gitFileDiff?(filePath: string): Promise<{ unifiedDiff: string; isBinary: boolean } | null>;
  sessionFileDiff?(filePath: string): Promise<{ unifiedDiff: string } | null>;
}

/**
 * Owns the per-file hunk refinement for the commit proposal widget: what this
 * session wrote, which hunks are checked, and which files are expanded.
 *
 * Split out of the widget because it is the one piece with real asynchrony --
 * two diff fetches per file and an ordering dependency between them.
 */
export function useHunkSelection(
  host: HunkSelectionHost | null | undefined,
  proposedFiles: string[],
  isPending: boolean
) {
  const [hunkStates, setHunkStates] = useState<Map<string, FileHunkState>>(new Map());
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loadingHunks, setLoadingHunks] = useState<Set<string>>(new Set());
  const [sessionSignatures, setSessionSignatures] = useState<Map<string, SessionEditSignature>>(new Map());
  const [signaturesLoaded, setSignaturesLoaded] = useState(false);

  // Ask what this session itself wrote in each proposed file, so hunks a
  // sibling session left behind can start unchecked. Runs once per proposal;
  // when the host cannot answer, every hunk stays checked as before.
  useEffect(() => {
    if (!isPending || !host?.sessionFileDiff || signaturesLoaded) return;
    let cancelled = false;

    void (async () => {
      const entries = await Promise.all(
        proposedFiles.map(async (filePath) => {
          const result = await host.sessionFileDiff?.(filePath);
          if (!result?.unifiedDiff) return null;
          const signature = buildSessionEditSignature(parseUnifiedDiffToHunks(result.unifiedDiff));
          if (signature.added.size === 0 && signature.removed.size === 0) return null;
          return [filePath, signature] as const;
        })
      );
      if (cancelled) return;
      setSessionSignatures(new Map(entries.filter((e): e is NonNullable<typeof e> => e !== null)));
      setSignaturesLoaded(true);
    })();

    return () => { cancelled = true; };
  }, [isPending, host, proposedFiles, signaturesLoaded]);

  /**
   * Fetch and parse a file's diff so its hunks can be selected individually.
   * Uses the same HEAD-vs-working-tree diff the peek popover shows, so the hunk
   * headers the user sees are the ones the staging path will be asked to match.
   */
  const loadHunkState = useCallback(async (filePath: string, revealIfNarrowed = false) => {
    if (!host?.gitFileDiff) return;
    setLoadingHunks((prev) => new Set(prev).add(filePath));
    try {
      const result = await host.gitFileDiff(filePath);
      if (!result) return;
      const parsed = parseUnifiedDiffToHunks(result.unifiedDiff);
      const state = buildFileHunkState(parsed, sessionSignatures.get(filePath) ?? null);
      setHunkStates((prev) => {
        const next = new Map(prev);
        next.set(filePath, state);
        return next;
      });
      // A narrowed file must show why on sight. Leaving it collapsed would hide
      // the exclusion banner behind a click, so the commit button could be
      // pressed without ever seeing that hunks were dropped.
      if (revealIfNarrowed && state.selected.size < state.hunks.length) {
        setExpandedFiles((prev) => new Set(prev).add(filePath));
      }
    } finally {
      setLoadingHunks((prev) => {
        const next = new Set(prev);
        next.delete(filePath);
        return next;
      });
    }
  }, [host, sessionSignatures]);

  // Once signatures are known, seed hunk state for any file the session only
  // partly owns, so the narrowing (and its banner) is visible before the user
  // expands anything.
  useEffect(() => {
    if (!signaturesLoaded || sessionSignatures.size === 0) return;
    for (const filePath of sessionSignatures.keys()) {
      if (!hunkStates.has(filePath)) void loadHunkState(filePath, true);
    }
  }, [signaturesLoaded, sessionSignatures, hunkStates, loadHunkState]);

  const toggleFileExpanded = useCallback((filePath: string) => {
    const willExpand = !expandedFiles.has(filePath);
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
    if (willExpand && !hunkStates.has(filePath)) void loadHunkState(filePath);
  }, [expandedFiles, hunkStates, loadHunkState]);

  const toggleHunk = useCallback((filePath: string, hunkIndex: number) => {
    setHunkStates((prev) => withHunkToggled(prev, filePath, hunkIndex));
  }, []);

  const selectAllHunks = useCallback((filePath: string) => {
    setHunkStates((prev) => withAllHunksSelected(prev, filePath));
  }, []);

  const selectAllHunksFor = useCallback((filePaths: readonly string[]) => {
    setHunkStates((prev) => {
      let next = prev;
      for (const filePath of filePaths) next = withAllHunksSelected(next, filePath);
      return next;
    });
  }, []);

  return {
    hunkStates,
    expandedFiles,
    loadingHunks,
    loadHunkState,
    toggleFileExpanded,
    toggleHunk,
    selectAllHunks,
    selectAllHunksFor,
  };
}
