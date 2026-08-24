import { hunkDisplayLines } from '../../../../git/unifiedDiffModel';
import { MaterialSymbol } from '../../../../icons/MaterialSymbol';
import { excludedHunkCount, type FileHunkState } from './selectionModel';

interface HunkListProps {
  filePath: string;
  state: FileHunkState;
  /** Name of the session that likely owns the excluded hunks, when known. */
  siblingSessionLabel?: string | null;
  onToggleHunk: (filePath: string, hunkIndex: number) => void;
  onSelectAll: (filePath: string) => void;
  disabled?: boolean;
}

/**
 * Per-hunk checkboxes for one file.
 *
 * Excluded hunks stay rendered at reduced opacity rather than being hidden: the
 * point of the feature is seeing what you are leaving behind.
 */
export function HunkList({
  filePath,
  state,
  siblingSessionLabel,
  onToggleHunk,
  onSelectAll,
  disabled,
}: HunkListProps) {
  if (!state.selectable || state.hunks.length === 0) return null;

  const excluded = excludedHunkCount(state);
  // The banner is about the *session-attributed* narrowing, so it only shows
  // while the current selection still matches what attribution picked.
  const narrowedBySession =
    state.sessionOwned.size > 0 &&
    state.sessionOwned.size < state.hunks.length &&
    excluded > 0;

  return (
    <div className="git-commit-widget__hunks pl-6 pr-2 pb-1">
      {excluded > 0 && (
        <div
          data-testid="git-commit-hunk-exclusion-banner"
          className="git-commit-widget__hunk-banner flex items-center gap-1.5 my-1 px-2 py-1 rounded border-l-2 border-[var(--nim-warning)] bg-[color-mix(in_srgb,var(--nim-warning)_9%,transparent)] text-[0.6875rem] leading-snug text-[var(--nim-warning)]"
        >
          <MaterialSymbol icon="info" size={12} className="shrink-0" />
          <span className="flex-1 min-w-0">
            {excluded} {excluded === 1 ? 'hunk' : 'hunks'} excluded
            {narrowedBySession && siblingSessionLabel
              ? ` — likely edited by session "${siblingSessionLabel}"`
              : narrowedBySession
                ? ' — not edited by this session'
                : ''}
            .
          </span>
          <button
            type="button"
            data-testid="git-commit-select-all-hunks"
            disabled={disabled}
            className="git-commit-widget__hunk-banner-action shrink-0 bg-transparent border-0 px-1 py-0.5 rounded text-[0.6875rem] font-medium text-[var(--nim-warning)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--nim-warning)_14%,transparent)] disabled:cursor-default disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation();
              onSelectAll(filePath);
            }}
          >
            Select all hunks
          </button>
        </div>
      )}

      <div className="git-commit-widget__hunk-list flex flex-col gap-1">
        {state.hunks.map((hunk) => {
          const isSelected = state.selected.has(hunk.index);
          return (
            <div
              key={hunk.index}
              data-testid="git-commit-hunk"
              data-selected={isSelected ? 'true' : 'false'}
              className={`git-commit-widget__hunk flex gap-1.5 px-1.5 py-1 rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] transition-opacity ${
                isSelected ? '' : 'opacity-40'
              }`}
            >
              <button
                type="button"
                data-testid="git-commit-hunk-checkbox"
                disabled={disabled}
                aria-label={isSelected ? 'Exclude this hunk' : 'Include this hunk'}
                aria-pressed={isSelected}
                className="shrink-0 bg-transparent border-0 p-0 pt-[3px] cursor-pointer disabled:cursor-default"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleHunk(filePath, hunk.index);
                }}
              >
                <span
                  className={`git-commit-widget__checkbox w-3.5 h-3.5 rounded-[3px] border-[1.5px] flex items-center justify-center transition-all ${
                    isSelected
                      ? 'bg-[var(--nim-file-edited)] border-[var(--nim-file-edited)]'
                      : 'border-[var(--nim-text-faint)] bg-transparent hover:border-[var(--nim-text-muted)]'
                  }`}
                >
                  {isSelected && (
                    <svg width="8" height="6" viewBox="0 0 8 6" fill="none" className="text-white">
                      <path
                        d="M1 3L3 5L7 1"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
              </button>

              <div className="min-w-0 flex-1 font-mono text-[0.6875rem] leading-[1.5]">
                <div className="text-[var(--nim-purple)] whitespace-pre overflow-hidden text-ellipsis">
                  {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
                  {hunk.section && (
                    <span className="text-[var(--nim-text-faint)]">{hunk.section}</span>
                  )}
                </div>
                {hunkDisplayLines(hunk)
                  .filter((line) => line.kind !== 'meta')
                  .slice(0, HUNK_PREVIEW_LINES)
                  .map((line, i) => (
                    <div
                      key={i}
                      className={`whitespace-pre overflow-hidden text-ellipsis ${
                        line.kind === 'add'
                          ? 'bg-[color-mix(in_srgb,var(--nim-success)_14%,transparent)]'
                          : line.kind === 'del'
                            ? 'bg-[color-mix(in_srgb,var(--nim-error)_14%,transparent)]'
                            : ''
                      }`}
                    >
                      <span
                        className={`inline-block w-3 text-center ${
                          line.kind === 'add'
                            ? 'text-[var(--nim-success)]'
                            : line.kind === 'del'
                              ? 'text-[var(--nim-error)]'
                              : 'text-[var(--nim-text-faint)]'
                        }`}
                      >
                        {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                      </span>
                      <span className="text-[var(--nim-text-muted)]">{line.text || ' '}</span>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Enough to recognise a hunk without turning the widget into a diff viewer. */
const HUNK_PREVIEW_LINES = 6;
