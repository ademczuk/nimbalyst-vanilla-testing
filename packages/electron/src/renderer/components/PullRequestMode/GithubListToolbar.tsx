/**
 * GithubListToolbar — search + sort + refresh row above the GitHub panel's
 * lists. Shared by the PR and issue lists; the sort vocabulary is supplied by
 * the caller so each list can offer its own keys.
 */

import type { JSX } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { FloatingPortal, useFloatingMenu } from '../../hooks/useFloatingMenu';

export interface GithubListSortOption<TKey extends string> {
  id: TKey;
  label: string;
}

interface GithubListToolbarProps<TKey extends string> {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  sortOptions: ReadonlyArray<GithubListSortOption<TKey>>;
  sortKey: TKey;
  onSortChange: (key: TKey) => void;
  onRefresh: () => void;
  loading: boolean;
  /** Prefix for `${prefix}-search-input` / `-sort-button` / `-refresh-button`. */
  testIdPrefix: string;
}

export function GithubListToolbar<TKey extends string>({
  search,
  onSearchChange,
  searchPlaceholder,
  sortOptions,
  sortKey,
  onSortChange,
  onRefresh,
  loading,
  testIdPrefix,
}: GithubListToolbarProps<TKey>): JSX.Element {
  const sortMenu = useFloatingMenu({ placement: 'bottom-end' });
  const activeSortLabel = sortOptions.find((o) => o.id === sortKey)?.label ?? sortOptions[0]?.label;

  return (
    <div className="github-list-toolbar flex items-center gap-2 px-3 py-2 border-b border-nim shrink-0">
      <div className="relative flex-1 min-w-0">
        <MaterialSymbol
          icon="search"
          size={15}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-nim-faint pointer-events-none"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          data-testid={`${testIdPrefix}-search-input`}
          className="nim-input w-full h-8 text-sm !py-0 !pl-7"
        />
      </div>

      <button
        ref={sortMenu.refs.setReference}
        {...sortMenu.getReferenceProps()}
        onClick={() => sortMenu.setIsOpen(!sortMenu.isOpen)}
        className="flex items-center gap-1 h-8 px-2 text-xs text-nim-muted hover:text-nim border border-nim rounded transition-colors shrink-0"
        data-testid={`${testIdPrefix}-sort-button`}
      >
        <MaterialSymbol icon="sort" size={15} />
        {activeSortLabel}
      </button>
      {sortMenu.isOpen && (
        <FloatingPortal>
          <div
            ref={sortMenu.refs.setFloating}
            style={sortMenu.floatingStyles}
            {...sortMenu.getFloatingProps()}
            className="z-50 min-w-[140px] bg-nim-secondary border border-nim rounded-md shadow-lg py-1"
          >
            {sortOptions.map((opt) => (
              <button
                key={opt.id}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  sortKey === opt.id
                    ? 'text-nim bg-nim-active'
                    : 'text-nim-muted hover:bg-nim-tertiary hover:text-nim'
                }`}
                onClick={() => {
                  onSortChange(opt.id);
                  sortMenu.setIsOpen(false);
                }}
              >
                {sortKey === opt.id && <MaterialSymbol icon="check" size={13} />}
                <span className={sortKey === opt.id ? '' : 'pl-[21px]'}>{opt.label}</span>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}

      <button
        onClick={onRefresh}
        disabled={loading}
        className="flex items-center justify-center w-8 h-8 text-nim-muted hover:text-nim border border-nim rounded transition-colors shrink-0 disabled:opacity-50"
        title="Refresh"
        data-testid={`${testIdPrefix}-refresh-button`}
      >
        <MaterialSymbol icon="refresh" size={16} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}
