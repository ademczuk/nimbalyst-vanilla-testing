import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { SavedView } from '@nimbalyst/collab-client/trackers';

/** The sidebar's Saved Views list (NIM-788), extracted verbatim from TrackerSidebar. */
export const TrackerSavedViewsSection: React.FC<{
  savedViews: SavedView[];
  activeSavedViewId: string | null;
  /** Sharing controls only make sense when the layout syncs to a team. */
  isSharedLayout: boolean;
  onApplyView: (view: SavedView) => void;
  /**
   * Omit on a host that cannot delete or reshare a view. The control is then not
   * rendered at all, rather than rendered against a handler that does nothing --
   * a button that silently declines is worse than an absent one.
   */
  onDeleteView?: (view: SavedView) => void;
  onToggleShareView?: (view: SavedView) => void;
}> = ({ savedViews, activeSavedViewId, isSharedLayout, onApplyView, onDeleteView, onToggleShareView }) => (
  <div className="px-2 pt-2 pb-1" data-testid="tracker-saved-views">
    <div className="flex items-center justify-between px-1 mb-1.5">
      <span className="text-[10px] font-semibold text-nim-faint uppercase tracking-wider">
        Saved Views
      </span>
    </div>

    {savedViews.length === 0 ? (
      <div className="px-1 text-[10px] text-nim-faint italic">
        Saved views will appear here.
      </div>
    ) : (
      <div className="flex flex-col gap-0.5">
        {savedViews.map((view) => (
          <div
            key={view.id}
            className={`group flex items-center gap-1 rounded-md ${
              activeSavedViewId === view.id ? 'bg-nim-active' : 'hover:bg-nim-tertiary'
            }`}
            data-testid="tracker-saved-view-item"
          >
            <button
              className="flex-1 flex items-center gap-2 px-2 py-1.5 text-left text-[12px] text-nim-muted hover:text-nim min-w-0"
              onClick={() => onApplyView(view)}
              title={`Apply view: ${view.name}`}
            >
              <MaterialSymbol
                icon={view.builtIn ? 'bolt' : 'bookmark'}
                size={13}
                className="shrink-0"
              />
              <span className="flex-1 truncate">{view.name}</span>
              {view.shared && (
                <MaterialSymbol
                  icon="group"
                  size={12}
                  className="shrink-0 text-nim-faint"
                  title="Shared with this team"
                />
              )}
            </button>
            {isSharedLayout && onToggleShareView && !view.builtIn && (
              <button
                className={view.shared
                  ? 'px-1.5 text-[var(--nim-primary)]'
                  : 'opacity-0 group-hover:opacity-100 px-1.5 text-nim-faint hover:text-nim transition-opacity'}
                onClick={() => onToggleShareView(view)}
                title={view.shared ? 'Stop sharing with the team' : 'Share view with the team'}
                data-testid="tracker-saved-view-share"
              >
                <MaterialSymbol icon={view.shared ? 'group' : 'group_add'} size={13} />
              </button>
            )}
            {onDeleteView && !view.builtIn && (
              <button
                className="opacity-0 group-hover:opacity-100 px-1.5 text-nim-faint hover:text-nim-error transition-opacity"
                onClick={() => onDeleteView(view)}
                title={view.shared ? 'Delete view for the whole team' : 'Delete view'}
                data-testid="tracker-saved-view-delete"
              >
                <MaterialSymbol icon="close" size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);
