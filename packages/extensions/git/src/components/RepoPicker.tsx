import { useCallback, useState } from 'react';
import {
  useFloating, offset, flip, shift, FloatingPortal,
  useDismiss, useRole, useInteractions, autoUpdate,
} from '@floating-ui/react';
import { repoLabels } from '../repoPaths';

interface RepoPickerProps {
  /** Repos the workspace spans, in root order. */
  repos: string[];
  /** Currently targeted repo. */
  current: string;
  onChange: (repoPath: string) => void;
  /**
   * Current branch per repo, filled in as the panel reads them. Absent entries
   * simply render without a branch rather than blocking the menu.
   */
  branchByRepo: Record<string, string>;
  /** Fired when the menu opens, so branches are read only when shown. */
  onRequestBranches: () => void;
}

/**
 * Repo selector for the Git panel header.
 *
 * Renders nothing when the workspace resolves to one repo, which is every
 * single-folder project -- the panel header is then byte-identical to what it
 * was before multi-root workspaces existed.
 */
export function RepoPicker({
  repos,
  current,
  onChange,
  branchByRepo,
  onRequestBranches,
}: RepoPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role]);

  const toggle = useCallback(() => {
    setIsOpen(open => {
      if (!open) onRequestBranches();
      return !open;
    });
  }, [onRequestBranches]);

  const handleSelect = useCallback((repoPath: string) => {
    onChange(repoPath);
    setIsOpen(false);
  }, [onChange]);

  if (repos.length < 2) return null;

  const labels = repoLabels(repos);

  return (
    <>
      <button
        ref={refs.setReference}
        className="git-log-select git-repo-picker-trigger"
        onClick={toggle}
        title={current}
        aria-label={`Repository: ${labels[current] ?? current}`}
        {...getReferenceProps()}
      >
        {labels[current] ?? current}
        <span className="git-repo-picker-chevron">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="git-branch-menu git-repo-menu"
            {...getFloatingProps()}
          >
            <div className="git-branch-menu-section">Repositories</div>
            {repos.map(repoPath => (
              <button
                key={repoPath}
                className={`git-branch-menu-item${repoPath === current ? ' git-branch-menu-item--current' : ''}`}
                onClick={() => handleSelect(repoPath)}
                title={repoPath}
              >
                <span className="git-branch-menu-item-name">{labels[repoPath] ?? repoPath}</span>
                {branchByRepo[repoPath] && (
                  <span className="git-repo-menu-branch">{branchByRepo[repoPath]}</span>
                )}
                {repoPath === current && <span className="git-branch-menu-item-check">✓</span>}
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
