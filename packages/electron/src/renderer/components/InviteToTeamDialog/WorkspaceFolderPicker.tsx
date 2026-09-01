/**
 * Picking local folders to publish into the team.
 *
 * Folders are the unit here for the reason they are the unit everywhere else
 * in this flow: asking "which folders should they see?" scales and asking file
 * by file does not. Only directories are listed — a file is publishable on its
 * own through Share to Team, and mixing the two here would suggest the
 * selection is a general file picker when its whole job is to seed a folder.
 *
 * Children load lazily on expand rather than eagerly: a workspace can be very
 * large, and walking it to render a dialog nobody has typed an address into
 * yet is work that is usually thrown away.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

interface FolderNode {
  name: string;
  path: string;
}

async function listSubfolders(dirPath: string): Promise<FolderNode[]> {
  const entries = await window.electronAPI?.getFolderContents?.(dirPath);
  return (entries ?? [])
    .filter(entry => entry.type === 'directory' && !entry.name.startsWith('.'))
    .map(entry => ({ name: entry.name, path: entry.path }));
}

function FolderRow({
  node,
  depth,
  selected,
  onToggle,
}: {
  node: FolderNode;
  depth: number;
  selected: string[];
  onToggle: (folderPath: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FolderNode[] | null>(null);

  useEffect(() => {
    if (!expanded || children !== null) return;
    let active = true;
    void listSubfolders(node.path)
      .then((next) => { if (active) setChildren(next); })
      // An unreadable folder collapses to "no subfolders" rather than taking
      // the dialog down; the folder itself is still selectable.
      .catch(() => { if (active) setChildren([]); });
    return () => { active = false; };
  }, [children, expanded, node.path]);

  return (
    <>
      <div className="flex items-center gap-2 py-1 text-sm" style={{ paddingLeft: `${depth * 1.1}rem` }}>
        <button
          type="button"
          className="grid size-4 shrink-0 place-items-center border-0 bg-transparent p-0 text-[var(--nim-text-faint)]"
          aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          onClick={() => setExpanded(current => !current)}
        >
          <MaterialSymbol icon={expanded ? 'expand_more' : 'chevron_right'} size={16} />
        </button>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[var(--nim-text)]">
          <input
            type="checkbox"
            checked={selected.includes(node.path)}
            onChange={() => onToggle(node.path)}
          />
          <MaterialSymbol icon="folder" size={15} className="shrink-0 text-[var(--nim-primary)]" />
          <span className="truncate">{node.name}</span>
        </label>
      </div>
      {expanded && children?.map(child => (
        <FolderRow
          key={child.path}
          node={child}
          depth={depth + 1}
          selected={selected}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

export function WorkspaceFolderPicker({
  workspacePath,
  selected,
  onToggle,
}: {
  workspacePath: string;
  selected: string[];
  onToggle: (folderPath: string) => void;
}) {
  const [roots, setRoots] = useState<FolderNode[] | null>(null);

  const load = useCallback(async () => {
    try {
      setRoots(await listSubfolders(workspacePath));
    } catch {
      setRoots([]);
    }
  }, [workspacePath]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="workspace-folder-picker max-h-[13rem] overflow-y-auto rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] px-2 py-1">
      {roots === null && <p className="m-0 p-2 text-xs text-[var(--nim-text-faint)]">Reading the workspace…</p>}
      {roots?.length === 0 && (
        <p className="m-0 p-2 text-xs text-[var(--nim-text-faint)]">
          This workspace has no folders to publish.
        </p>
      )}
      {roots?.map(node => (
        <FolderRow key={node.path} node={node} depth={0} selected={selected} onToggle={onToggle} />
      ))}
    </div>
  );
}
