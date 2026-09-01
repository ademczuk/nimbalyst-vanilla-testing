import React from 'react';
import './collabSidebarTree.css';
export interface CollabSidebarProps {
    activeDocumentId?: string | null;
    /** Open the discovery hub (center pane). Shown as a Home action. */
    onShowHome?: () => void;
    /** Highlight the Home action when the hub is the active surface. */
    homeActive?: boolean;
    /** Host-owned scope label and path chrome; sidebar actions remain shared. */
    scopeName?: React.ReactNode;
    scopePath?: React.ReactNode;
    headerActions?: React.ReactNode;
    /**
     * Hosts where a folder is an addressable surface (the browser console routes
     * `/docs/folder/:folderId`). Desktop leaves this unset, so a folder click
     * stays a pure expand/select there.
     */
    onSelectFolder?: (folderId: string | null) => void;
    /**
     * Publishes this tree's create menu to a host outside it (the desktop title
     * bar's create control). The list is built here because the catalog filtering
     * that decides which types are shareable at all lives here; a second copy in
     * the host would drift from it.
     */
    registerCreateMenu?: (menu: CollabSidebarCreateMenu | null) => void;
}
export interface CollabSidebarCreateMenu {
    items: Array<{
        id: string;
        label: string;
        icon: string;
        onSelect: () => void;
    }>;
    /** Folder the new document lands in, or null for the space root. */
    destination: string | null;
    /** Default action: a shared Markdown doc. */
    onPrimary: () => void;
    /** Extension the default action produces, shown beside it. */
    primaryTrailing?: string;
    onNewFolder: () => void;
}
export declare const CollabSidebar: React.FC<CollabSidebarProps>;
