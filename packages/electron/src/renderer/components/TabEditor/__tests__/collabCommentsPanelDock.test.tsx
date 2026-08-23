// @vitest-environment jsdom
/**
 * The host-owned comments pane for a collaborative extension tab, driven the
 * way the product drives it: through the SDK service's `openPanel`, and through
 * a deep-link request queued before the pane exists.
 *
 * Everything under test is production code over a real Y.Doc — the repository,
 * the hosted service, the anchor-adapter registry, and the shared panel. Only
 * the notification lane is replaced.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Doc } from 'yjs';

import {
  collabCommentAnchorAdapterRegistry,
  collabCommentControllerRegistry,
} from '@nimbalyst/runtime/editor/commenting/CollabCommentControllerRegistry';
import type { CommentAnchor } from '@nimbalyst/runtime/editor/commenting/types';
import type { MountedCommentAnchorAdapter } from '@nimbalyst/extension-sdk';

import {
  createCommentPanelOpener,
  requestCommentPanel,
  resetCommentPanelRequests,
} from '../collabCommentPanelRequests';
import {
  CollabCommentsPanelDock,
  useCollabCommentsPanel,
} from '../CollabCommentsPanelDock';
import {
  createHostedCollaborationComments,
  type HostedCollaborationComments,
} from '../collaborationCommentsService';

vi.mock('../../../services/ErrorNotificationService', () => ({
  errorNotificationService: { showError: vi.fn() },
}));

const DOCUMENT_URI = 'collab://org:org-1:doc:mockup-1';
const PIN_ANCHOR: CommentAnchor = {
  kind: 'entity',
  entityType: 'mockup-pin',
  entityId: 'pin-1',
  labelSnapshot: 'button:Save changes',
};

function Harness({ hosted }: { hosted: HostedCollaborationComments }) {
  const panel = useCollabCommentsPanel({
    documentUri: DOCUMENT_URI,
    panelSource: hosted.panelSource,
  });
  return <CollabCommentsPanelDock hosted={hosted} panel={panel} />;
}

describe('host-owned collaborative comments pane', () => {
  let hosted: HostedCollaborationComments;
  let capabilities: { read: boolean; comment: boolean };
  /** The extension's canvas. Deleting a pin is how a thread becomes orphaned. */
  let livePins: Set<string>;
  let focusCalls: string[];
  let threadId: string;

  const adapter = (): MountedCommentAnchorAdapter => ({
    handles: (anchor) =>
      anchor.kind === 'entity' && anchor.entityType === 'mockup-pin',
    getState: (anchor) =>
      anchor.kind === 'entity' && livePins.has(anchor.entityId)
        ? 'attached'
        : 'orphaned',
    describe: (anchor) =>
      anchor.kind === 'entity' ? anchor.labelSnapshot ?? anchor.entityId : '',
    focus: (anchor) => {
      if (anchor.kind !== 'entity') return false;
      focusCalls.push(anchor.entityId);
      return livePins.has(anchor.entityId);
    },
  });

  const cards = (container: HTMLElement): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>('.nim-comment-thread'));

  beforeEach(async () => {
    resetCommentPanelRequests();
    collabCommentAnchorAdapterRegistry.clear();
    collabCommentControllerRegistry.clear();
    livePins = new Set(['pin-1']);
    focusCalls = [];
    capabilities = { read: true, comment: true };

    hosted = createHostedCollaborationComments({
      yDoc: new Doc(),
      host: {
        currentUser: { id: 'user-1', name: 'Ada' },
        documentId: 'mockup-1',
        documentTitle: 'Checkout review',
        documentUri: DOCUMENT_URI,
        instanceId: 'instance-1',
        getMembers: () => [],
        isActive: () => true,
        isVisible: () => true,
        isHydrated: () => true,
        resolveCapabilities: async () => capabilities,
        onOpenPanel: createCommentPanelOpener(DOCUMENT_URI),
      },
    });
    hosted.service.registerAnchorAdapter(adapter());
    // Capabilities resolve asynchronously, and creation is refused until they do.
    await waitFor(() =>
      expect(hosted.service.getCapabilities().comment).toBe(true),
    );
    const created = await hosted.service.createThread({
      anchor: PIN_ANCHOR,
      content: 'Tighten this label',
      clientMutationId: 'mutation-1',
    });
    threadId = created.thread.id;
  });

  afterEach(() => {
    cleanup();
    hosted.destroy();
    collabCommentAnchorAdapterRegistry.clear();
    collabCommentControllerRegistry.clear();
    resetCommentPanelRequests();
  });

  it('opens on openPanel with that thread selected and its anchor focused', async () => {
    const { container } = render(<Harness hosted={hosted} />);

    await act(async () => {
      hosted.service.openPanel({ threadId });
    });

    const [card] = cards(container);
    expect(card.dataset.threadId).toBe(threadId);
    expect(card.getAttribute('aria-current')).toBe('true');
    await waitFor(() => expect(focusCalls).toEqual(['pin-1']));
    expect(
      container.querySelector('[data-testid="collab-comments-focus-notice"]'),
    ).toBeNull();
  });

  it('drains a deep-link request queued before the pane mounted', async () => {
    // The notification is clicked while the document is still opening, so the
    // request has to outlive the click and be picked up when the tab mounts.
    requestCommentPanel(DOCUMENT_URI, { threadId, source: 'deep-link' });

    const { container } = render(<Harness hosted={hosted} />);

    await waitFor(() => expect(focusCalls).toEqual(['pin-1']));
    expect(cards(container)[0].getAttribute('aria-current')).toBe('true');
  });

  it('keeps an orphaned thread visible and explains why focus is unavailable', async () => {
    const { container } = render(<Harness hosted={hosted} />);
    // A teammate deletes the element the thread hangs off. Losing the target
    // must not lose the conversation.
    livePins.delete('pin-1');

    await act(async () => {
      requestCommentPanel(DOCUMENT_URI, { threadId, source: 'deep-link' });
    });

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="collab-comments-focus-notice"]')
          ?.textContent,
      ).toMatch(/no longer in the document/i),
    );
    const [card] = cards(container);
    expect(card.dataset.threadId).toBe(threadId);
    expect(card.dataset.anchorState).toBe('orphaned');
    expect(card.textContent).toContain('Tighten this label');
  });

  it('drops the composer on a capability downgrade without losing threads', async () => {
    const { container } = render(<Harness hosted={hosted} />);
    await act(async () => {
      hosted.service.openPanel({});
    });
    expect(container.querySelector('.nim-comment-composer-input')).not.toBeNull();

    capabilities = { read: true, comment: false };
    // The downgrade applies to the next operation, with no remount: the service
    // re-reads access, the panel re-renders read-only, the thread stays.
    await act(async () => {
      await hosted.service.setResolved(threadId, true).catch(() => undefined);
    });

    await waitFor(() =>
      expect(container.querySelector('.nim-comment-composer-input')).toBeNull(),
    );
    expect(cards(container)).toHaveLength(1);
    expect(
      container.querySelector('.nim-comments-panel-notice')?.textContent,
    ).toMatch(/read-only/i);
  });
});
