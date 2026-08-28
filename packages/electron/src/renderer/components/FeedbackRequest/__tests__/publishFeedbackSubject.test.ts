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

describe('publishFeedbackSubject — destination', () => {
  const FILE_REF = {
    orgId: ORG_ID,
    kind: 'file' as const,
    sourceId: 'mockups/direction-a.mockup.html',
  };
  const DESTINATION = { folderId: 'f-feedback', folderPath: 'Feedback requests' };

  function stubUnsharedFile(): void {
    stubElectronAPI({
      documentSync: { findLocalOriginLink: vi.fn().mockResolvedValue({ success: true, binding: null }) },
    });
  }

  it('asks the share flow to skip its dialog when the destination answers everything', async () => {
    stubUnsharedFile();
    shareFlow.askShareToTeam.mockResolvedValue({
      status: 'answered',
      answers: { folderId: 'f-feedback', folderPath: 'Feedback requests' },
    });
    shareFlow.shareFileToTeam.mockResolvedValue({
      status: 'shared',
      orgId: ORG_ID,
      documentId: 'doc-new',
    });

    const outcome = await publishFeedbackSubject(FILE_REF, {
      workspacePath: '/tmp/workspace',
      destination: DESTINATION,
    });

    expect(shareFlow.askShareToTeam).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'direction-a.mockup.html' }),
      { destination: DESTINATION, skipWhenFullyAnswered: true },
    );
    expect(outcome).toEqual({
      success: true,
      ref: { orgId: ORG_ID, kind: 'document', sourceId: 'doc-new' },
    });
    // One request, one write of the workspace default -- the compose host does
    // it once after the batch instead.
    expect(shareFlow.shareFileToTeam).toHaveBeenCalledWith(
      expect.objectContaining({ persistLastSharedFolder: false, openAfterCreate: false }),
    );
  });

  it('keeps the folder the author picked in the dialog over the request-level one', async () => {
    stubUnsharedFile();
    // What a dialog looks like when the author moved it somewhere else.
    shareFlow.askShareToTeam.mockResolvedValue({
      status: 'answered',
      answers: { folderId: 'f-elsewhere', folderPath: 'Product/Specs' },
    });
    shareFlow.shareFileToTeam.mockResolvedValue({
      status: 'shared',
      orgId: ORG_ID,
      documentId: 'doc-new',
    });

    const plan = await prepareFeedbackSubjectPublish(FILE_REF, {
      workspacePath: '/tmp/workspace',
      destination: DESTINATION,
    });
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    // The folder created for the request arrives at run time and must not
    // overwrite an answer the author gave explicitly.
    await plan.run({ folderId: 'f-created', folderPath: 'Feedback requests' });

    expect(shareFlow.shareFileToTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: expect.objectContaining({ folderId: 'f-elsewhere', folderPath: 'Product/Specs' }),
      }),
    );
  });

  it('publishes into the folder created between the two passes', async () => {
    stubUnsharedFile();
    shareFlow.askShareToTeam.mockResolvedValue({
      status: 'answered',
      // Preparing saw no folder yet: it did not exist when the picker painted.
      answers: { folderId: null, folderPath: '' },
    });
    shareFlow.shareFileToTeam.mockResolvedValue({
      status: 'shared',
      orgId: ORG_ID,
      documentId: 'doc-new',
    });

    const plan = await prepareFeedbackSubjectPublish(FILE_REF, {
      workspacePath: '/tmp/workspace',
      destination: { folderId: null, folderPath: '' },
    });
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    await plan.run({ folderId: 'f-created', folderPath: 'Feedback requests' });

    expect(shareFlow.shareFileToTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: expect.objectContaining({
          folderId: 'f-created',
          folderPath: 'Feedback requests',
        }),
      }),
    );
  });

  it('still asks per file when no destination was chosen', async () => {
    stubUnsharedFile();
    shareFlow.askShareToTeam.mockResolvedValue({ status: 'cancelled' });

    const plan = await prepareFeedbackSubjectPublish(FILE_REF, {
      workspacePath: '/tmp/workspace',
    });

    expect(shareFlow.askShareToTeam).toHaveBeenCalledWith(expect.anything(), {});
    expect(plan.status).toBe('blocked');
  });
});
