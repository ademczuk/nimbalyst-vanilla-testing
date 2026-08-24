// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { atom, createStore, Provider } from 'jotai';
import type { CollabHost, TeamMemberSummary } from '@nimbalyst/collab-client/core';
import type { CollabDocsSession, SharedDocument } from '@nimbalyst/collab-client/docs';
import { CollabDocsUIProvider } from '../CollabDocsUIProvider';
import { SharedDocsListView } from '../SharedDocsListView';

vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

const documents: SharedDocument[] = [{
  documentId: 'doc-from-teammate',
  teamProjectId: 'project-primary',
  title: 'Launch plan.md',
  documentType: 'markdown',
  createdBy: 'member-teammate',
  createdAt: 1,
  updatedAt: 10,
  lastWriterUserId: 'member-teammate',
  parentFolderId: null,
}] as unknown as SharedDocument[];

const documentTypes = [] as const;
const notUnread = atom(false);

/**
 * A host whose member directory is empty until the team room replies, which is
 * how the real one behaves: `getMembers()` reads a synchronous snapshot of
 * `TeamSyncProvider.getTeamState()`, and that stays null until the server's
 * `teamSync` message lands — well after the list has mounted.
 */
function createLateDirectoryHost() {
  let members: TeamMemberSummary[] = [];
  const listeners = new Set<() => void>();
  const host = {
    surface: 'desktop',
    documents: {
      documentTypes: () => documentTypes,
      onDocumentTypesChanged: () => () => undefined,
    },
    getMembers: async () => members,
    onMembersChanged: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    openArtifact: vi.fn(),
  } as unknown as CollabHost;

  return {
    host,
    loadTeamState() {
      members = [{
        memberId: 'member-teammate',
        email: 'teammate@example.test',
        name: 'Ada Teammate',
      } as TeamMemberSummary];
      for (const listener of listeners) listener();
    },
  };
}

function renderList(host: CollabHost) {
  const session = {
    scope: {
      scopeKey: 'desktop:org-member-test:project-primary',
      orgId: 'org-member-test',
      indexConfig: {
        serverUrl: 'ws://sync.test',
        teamProjectId: 'project-primary',
        teamMemberId: 'member-self',
        userEmail: 'self@example.test',
      },
    },
    host,
    uiCapabilities: { personalState: false, readReceipts: false },
    atoms: {
      sharedDocuments: atom(documents),
      allSharedDocuments: atom(documents),
      trashedSharedDocuments: atom([]),
      sharedFolders: atom([]),
      syncStatus: atom('connected'),
      hasTeam: atom(true),
      activeTeamUserId: atom('member-self'),
      favorites: atom([]),
      changedDocumentIds: atom(new Set<string>()),
      openedAt: atom({}),
      receipts: atom(new Map()),
      treeFilter: atom<'all' | 'favorites' | 'updated'>('all'),
      showUnreadBubbles: atom(true),
      pendingFolder: atom(null),
      unreadDocument: () => notUnread,
    },
    toggleFavorite: vi.fn(),
    markAllDocumentsViewed: vi.fn(),
    markDocumentViewed: vi.fn(),
  } as unknown as CollabDocsSession;

  return render(
    <Provider store={createStore()}>
      <CollabDocsUIProvider session={session}>
        <SharedDocsListView />
      </CollabDocsUIProvider>
    </Provider>,
  );
}

afterEach(cleanup);

/**
 * NIM-3716. Created by (and the last-edited author) rendered "Unknown" for
 * every teammate forever: the directory was fetched once from a `useEffect` at
 * mount, which always lost the race against team-state load, and nothing ever
 * re-read it.
 */
describe('shared docs member directory', () => {
  it('resolves author names once team state arrives after mount', async () => {
    const { host, loadTeamState } = createLateDirectoryHost();
    const { container } = renderList(host);

    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('Unknown');

    await act(async () => {
      loadTeamState();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Ada Teammate');
    expect(container.textContent).not.toContain('Unknown');
  });
});
