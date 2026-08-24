/**
 * GithubListSwitcher — the PRs / Issues segmented control above the panel's
 * filter sidebar. Switching only flips `activeGithubList`; each list keeps its
 * own selection in the layout, so coming back restores what was open.
 */

import type { JSX } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { GithubListKind } from '../../store/atoms/pullRequests';

interface GithubListSwitcherProps {
  active: GithubListKind;
  onChange: (kind: GithubListKind) => void;
  /** Cached row counts; omitted (or zero) renders no badge. */
  prCount?: number;
  issueCount?: number;
}

const SEGMENTS: { id: GithubListKind; label: string; icon: string }[] = [
  { id: 'prs', label: 'Pull Requests', icon: 'merge' },
  { id: 'issues', label: 'Issues', icon: 'adjust' },
];

export function GithubListSwitcher({
  active,
  onChange,
  prCount,
  issueCount,
}: GithubListSwitcherProps): JSX.Element {
  const counts: Record<GithubListKind, number | undefined> = { prs: prCount, issues: issueCount };

  return (
    <div className="github-list-switcher px-2 py-2 border-b border-nim shrink-0">
      <div
        role="tablist"
        aria-label="GitHub list"
        className="flex gap-0.5 p-0.5 rounded-md bg-nim border border-nim"
      >
        {SEGMENTS.map((segment) => {
          const isActive = active === segment.id;
          const count = counts[segment.id];
          return (
            <button
              key={segment.id}
              role="tab"
              aria-selected={isActive}
              data-testid={`github-list-tab-${segment.id}`}
              onClick={() => onChange(segment.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                isActive
                  ? 'bg-nim-tertiary text-nim'
                  : 'text-nim-faint hover:text-nim hover:bg-nim-active'
              }`}
            >
              <MaterialSymbol icon={segment.icon} size={14} />
              {segment.label}
              {count !== undefined && count > 0 && (
                <span
                  className={`px-1.5 rounded-full text-[10px] ${
                    isActive ? 'bg-[var(--nim-primary)] text-nim-on-primary' : 'bg-nim-tertiary'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
