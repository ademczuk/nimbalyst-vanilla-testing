// @vitest-environment node

/**
 * The two publish decisions that are invisible on inspection and expensive to
 * get wrong: a file that is already shared must not be shared a second time
 * (a retry after a failed send would otherwise litter the team's files), and a
 * tracker item whose type is personal-scoped is not actually team-visible even
 * though the write succeeded.
 *
 * Only the IPC boundary is stubbed. The share-to-team creation path is covered
 * by CommonFileActions.shareToTeam.test.tsx; both branches here short-circuit
 * before it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import { prepareFeedbackSubjectPublish, publishFeedbackSubject } from '../publishFeedbackSubject';

const shareFlow = vi.hoisted(() => ({
  askShareToTeam: vi.fn(),
  shareFileToTeam: vi.fn(),
}));
vi.mock('../../../services/shareToTeamFlow', () => shareFlow);

const ORG_ID = 'org-1';

function stubElectronAPI(api: Record<string, unknown>): void {
  (globalThis as { window?: unknown }).window = { electronAPI: api };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('publishFeedbackSubject', () => {
  it('reuses the shared document a file is already bound to instead of sharing it again', async () => {
    const findLocalOriginLink = vi.fn().mockResolvedValue({
      success: true,
      binding: { orgId: ORG_ID, documentId: 'doc-existing' },
    });
    stubElectronAPI({ documentSync: { findLocalOriginLink } });

    const outcome = await publishFeedbackSubject(
      { orgId: ORG_ID, kind: 'file', sourceId: 'mockups/direction-a.mockup.html' },
      { workspacePath: '/tmp/workspace' },
    );

    expect(outcome).toEqual({
      success: true,
      ref: { orgId: ORG_ID, kind: 'document', sourceId: 'doc-existing' },
    });
    // The binding is looked up by absolute path even though the subject named a
    // workspace-relative one.
    expect(findLocalOriginLink).toHaveBeenCalledWith(
      '/tmp/workspace',
      '/tmp/workspace/mockups/direction-a.mockup.html',
    );
  });

  it('fails a tracker publish that left the item personal because its type is personal-scoped', async () => {
    const setTrackerItemPublished = vi.fn().mockResolvedValue({
      success: true,
      item: { id: 'item-1' },
      teamVisible: false,
    });
    stubElectronAPI({ documentService: { setTrackerItemPublished } });

    const outcome = await publishFeedbackSubject(
      { orgId: ORG_ID, kind: 'tracker', sourceId: 'item-1' },
      { workspacePath: '/tmp/workspace' },
    );

    expect(outcome.success).toBe(false);
    expect(outcome).toHaveProperty('error', expect.stringContaining('personal-scoped'));
  });

  it('blocks the subject without sharing anything when the author closes the share dialog', async () => {
    shareFlow.askShareToTeam.mockResolvedValue({ status: 'cancelled' });
    stubElectronAPI({
      documentSync: { findLocalOriginLink: vi.fn().mockResolvedValue({ success: true, binding: null }) },
    });

    const plan = await prepareFeedbackSubjectPublish(
      { orgId: ORG_ID, kind: 'file', sourceId: 'mockups/direction-a.mockup.html' },
      { workspacePath: '/tmp/workspace' },
    );

    expect(plan.status).toBe('blocked');
    // Preparing must stay side-effect free, or an abandoned multi-subject send
    // leaves the team with documents nobody asked about.
    expect(shareFlow.shareFileToTeam).not.toHaveBeenCalled();
  });

  it('refuses a session subject outright', async () => {
    stubElectronAPI({});

    const outcome = await publishFeedbackSubject(
      { orgId: ORG_ID, kind: 'session', sourceId: 'session-9' },
      { workspacePath: '/tmp/workspace' },
    );

    expect(outcome.success).toBe(false);
  });
});
