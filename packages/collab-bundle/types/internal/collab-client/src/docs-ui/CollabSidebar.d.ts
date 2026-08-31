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
     * Lets a host outside this tree (the desktop title bar's create control) open
     * the shared-document type menu against its own anchor. The menu stays here
     * because the catalog filtering that decides which types are shareable at all
     * lives here; a second copy in the host would drift from it.
     */
    registerCreateDocumentTrigger?: (open: ((anchor: HTMLElement) => void) | null) => void;
}
export declare const CollabSidebar: React.FC<CollabSidebarProps>;
