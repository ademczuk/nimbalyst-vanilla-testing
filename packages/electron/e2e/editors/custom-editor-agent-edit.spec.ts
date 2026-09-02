/**
 * Open custom-editor tab refresh after AI edits (NIM-1484)
 *
 * When an AI session edits a file whose OPEN tab is a custom editor with
 * supportsDiffMode: false (Excalidraw here; same registration shape as the
 * Replicad extension where the bug was reported), the diff session takes the
 * auto-accept branch in TabEditor.applyDiffState. That branch resolves the
 * diff, but the DocumentModel's notifyFileChanged(finalContent) fires while
 * isApplyingDiffRef/pendingAIEditTagRef are still set, so the custom editor's
 * subscribeToFileChanges wrapper drops it -- and nothing in that branch ever
 * clears pendingAIEditTagRef, leaving the tab deaf to ALL later file changes
 * until it is closed and reopened.
 *
 * Uses the same pre-edit history tag technique as agent-edit-focus.spec.ts to
 * make the file watcher correlate an out-of-band disk write to an AI session
 * and route it through the DocumentModel diff branch.
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  launchElectronApp,
  createTempWorkspace,
  waitForAppReady,
  dismissProjectTrustToast,
  TEST_TIMEOUTS,
} from '../helpers';
import { openFileFromTree, switchToAgentMode, switchToFilesMode } from '../utils/testHelpers';

test.describe.configure({ mode: 'serial' });

let electronApp: ElectronApplication;
let page: Page;
let workspaceDir: string;

const FILE_NAME = 'agent-edit-test.excalidraw';
const DUAL_FILE_NAME = 'dual-attach-test.excalidraw';
const REPEATED_FILE_NAME = 'repeated-agent-writes.excalidraw';
const LATE_REGISTRATION_FILE_NAME = 'late-registration.excalidraw';

function makeRect(id: string, x: number): Record<string, unknown> {
  return {
    id, type: 'rectangle', x, y: 10, width: 100, height: 50,
    strokeColor: '#1e1e1e', backgroundColor: 'transparent',
    fillStyle: 'solid', strokeWidth: 2, roughness: 1, opacity: 100,
    angle: 0, groupIds: [], frameId: null,
    roundness: { type: 3 }, boundElements: [],
    updated: 1700000000000, link: null, locked: false,
    version: 1, versionNonce: 1, isDeleted: false, seed: 12345,
  };
}

function excalidrawFile(elements: Record<string, unknown>[]): string {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements,
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  }, null, 2);
}

// Read the OPEN tab's live scene element ids through the central editor API
// (the same registry AI tools use for a visible tab).
async function getSceneElementIds(filePath: string): Promise<string[]> {
  return page.evaluate((filePath) => {
    const getEditorAPI = (window as any).__testHelpers?.getExtensionEditorAPI;
    const api = getEditorAPI?.(filePath);
    if (!api) return [];
    return (api.getSceneElements() || []).map((e: any) => e.id);
  }, filePath);
}

test.beforeAll(async () => {
  workspaceDir = await createTempWorkspace();
  await fs.writeFile(path.join(workspaceDir, FILE_NAME), excalidrawFile([makeRect('seed-rect', 10)]), 'utf8');
  await fs.writeFile(path.join(workspaceDir, DUAL_FILE_NAME), excalidrawFile([makeRect('seed-rect', 10)]), 'utf8');
  await fs.writeFile(path.join(workspaceDir, REPEATED_FILE_NAME), excalidrawFile([makeRect('seed-rect', 10)]), 'utf8');
  await fs.writeFile(path.join(workspaceDir, LATE_REGISTRATION_FILE_NAME), excalidrawFile([makeRect('seed-rect', 10)]), 'utf8');

  electronApp = await launchElectronApp({ workspace: workspaceDir });
  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await waitForAppReady(page);
  await dismissProjectTrustToast(page);
});

test.afterAll(async () => {
  await electronApp?.close();
  if (workspaceDir) {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test('open custom-editor tab picks up an AI (diff-routed) edit and stays subscribed', async () => {
  const filePath = path.join(workspaceDir, FILE_NAME);
  const baseline = excalidrawFile([makeRect('seed-rect', 10)]);

  await openFileFromTree(page, FILE_NAME);
  await page.waitForSelector('.excalidraw-editor', { timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // Editor mounted with the seed content and its API registered.
  await expect.poll(() => getSceneElementIds(filePath), { timeout: 10000 })
    .toContain('seed-rect');

  // Pre-edit tag so the file watcher correlates the next disk write to an AI
  // session and routes it through the DocumentModel diff session (the
  // auto-accept branch, since Excalidraw declares supportsDiffMode: false).
  await page.evaluate(async ({ workspacePath, filePath, content }) => {
    await (window as any).electronAPI.history.createTag(
      workspacePath,
      filePath,
      `agent-edit-tag-${Date.now()}`,
      content,
      'agent-edit-session',
      'tool-agent-edit',
    );
  }, { workspacePath: workspaceDir, filePath, content: baseline });
  await page.waitForTimeout(200);

  // The "agent" edit: out-of-band disk write adding a second element.
  await fs.writeFile(filePath, excalidrawFile([makeRect('seed-rect', 10), makeRect('agent-rect-1', 200)]), 'utf8');

  // The open tab must reflect the AI edit without close/reopen.
  await expect.poll(() => getSceneElementIds(filePath), { timeout: 10000 })
    .toContain('agent-rect-1');

  // Regression guard for the leaked pendingAIEditTag: a SUBSEQUENT plain
  // external change (no AI tag) must also reach the still-open tab.
  await fs.writeFile(
    filePath,
    excalidrawFile([makeRect('seed-rect', 10), makeRect('agent-rect-1', 200), makeRect('external-rect-2', 400)]),
    'utf8'
  );
  await expect.poll(() => getSceneElementIds(filePath), { timeout: 10000 })
    .toContain('external-rect-2');
});

test('dual attachment (Files + Agent mode): AI edit refreshes, nothing sticks in diff mode, disk not clobbered', async () => {
  const filePath = path.join(workspaceDir, DUAL_FILE_NAME);
  const baseline = excalidrawFile([makeRect('seed-rect', 10)]);
  await fs.writeFile(filePath, baseline, 'utf8');

  // Attachment A: Files mode. Scope the wait to THIS file's instance -- the
  // previous test's (hidden) excalidraw editor is still mounted.
  await switchToFilesMode(page);
  await openFileFromTree(page, DUAL_FILE_NAME);
  await expect(
    page.locator(`[data-file-path="${filePath}"].multi-editor-instance .excalidraw-editor`)
  ).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });
  await expect.poll(() => getSceneElementIds(filePath), { timeout: 10000 })
    .toContain('seed-rect');

  // Attachment B: the same file open in Agent mode (real second TabEditor,
  // second DocumentModel attachment -- both receive onDiffRequested and both
  // take the auto-accept branch).
  await switchToAgentMode(page);
  await page.evaluate(async ({ workspacePath, filePath }) => {
    const helpers = (window as any).__testHelpers;
    if (!helpers?.openFileInAgentMode) {
      throw new Error('openFileInAgentMode test helper not exposed');
    }
    return helpers.openFileInAgentMode(workspacePath, filePath);
  }, { workspacePath: workspaceDir, filePath });
  await page.waitForFunction((fp) => {
    return document.querySelectorAll(`[data-file-path="${fp}"].multi-editor-instance`).length >= 2;
  }, filePath, { timeout: 10000 });
  await page.waitForTimeout(500);

  // AI-correlated edit (same technique as the single-tab test).
  await page.evaluate(async ({ workspacePath, filePath, content }) => {
    await (window as any).electronAPI.history.createTag(
      workspacePath,
      filePath,
      `dual-attach-tag-${Date.now()}`,
      content,
      'dual-attach-session',
      'tool-dual-attach',
    );
  }, { workspacePath: workspaceDir, filePath, content: baseline });
  await page.waitForTimeout(200);

  await fs.writeFile(filePath, excalidrawFile([makeRect('seed-rect', 10), makeRect('agent-rect-1', 200)]), 'utf8');

  // The registered editor API (last-registered attachment) must see the edit.
  await expect.poll(() => getSceneElementIds(filePath), { timeout: 10000 })
    .toContain('agent-rect-1');

  // Neither attachment may be stuck in diff mode: no built-in diff header and
  // no custom-editor diff approval bar anywhere.
  await expect(page.locator('.unified-diff-header')).toHaveCount(0);

  // A later plain external change must still reach the tab (leaked-tag guard),
  // in both modes' attachments' shared DocumentModel.
  await fs.writeFile(
    filePath,
    excalidrawFile([makeRect('seed-rect', 10), makeRect('agent-rect-1', 200), makeRect('external-rect-2', 400)]),
    'utf8'
  );
  await expect.poll(() => getSceneElementIds(filePath), { timeout: 10000 })
    .toContain('external-rect-2');

  // Disk must hold exactly the external content: neither attachment may have
  // flushed a stale buffer back over it (the NIM-905 clobber, dual-tab flavor).
  await page.waitForTimeout(2000);
  const diskData = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const ids = (diskData.elements || []).map((e: { id: string }) => e.id);
  expect(ids.sort()).toEqual(['agent-rect-1', 'external-rect-2', 'seed-rect']);

  await switchToFilesMode(page);
});

// ===========================================================================
// NIM-5359 (plan item 1h) -- shared-path parity for custom editors.
//
// Both tests below describe the contract after the consolidation in
// nimbalyst-local/plans/mount-diff-path-reverts-agent-writes.md: one
// presentation path, generation-scoped acknowledgement, and registration as the
// custom-editor readiness signal.
// ===========================================================================

// A no-diff-view custom editor takes the auto-accept branch. The resolution
// promise itself is that editor's completion -- it must not ALSO send a generic
// apply acknowledgement, or three back-to-back agent writes can resolve more
// than once (extra pre-edit tags) or leave the model mid-resolution while a
// newer generation is already queued.
test('no-diff custom editor auto-accepts repeated agent writes and resolves exactly once', async () => {
  test.setTimeout(120_000);
  const filePath = path.join(workspaceDir, REPEATED_FILE_NAME);
  const baseline = excalidrawFile([makeRect('seed-rect', 10)]);
  await fs.writeFile(filePath, baseline, 'utf8');

  await switchToFilesMode(page);
  await openFileFromTree(page, REPEATED_FILE_NAME);
  await expect(
    page.locator(`[data-file-path="${filePath}"].multi-editor-instance .excalidraw-editor`)
  ).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  await page.evaluate(async ({ workspacePath, fp, content }) => {
    await (window as any).electronAPI.history.createTag(
      workspacePath, fp, 'repeated-writes-tag', content, 'repeated-writes-session', 'tool-repeated',
    );
  }, { workspacePath: workspaceDir, fp: filePath, content: baseline });
  await page.waitForTimeout(200);

  // Three generations, the last two inside the previous apply's settle window.
  const rects = ['agent-rect-1', 'agent-rect-2', 'agent-rect-3'];
  for (let i = 0; i < rects.length; i++) {
    const elements = [makeRect('seed-rect', 10), ...rects.slice(0, i + 1).map((id, n) => makeRect(id, 200 + n * 120))];
    await fs.writeFile(filePath, excalidrawFile(elements), 'utf8');
    await page.waitForTimeout(i === 0 ? 900 : 150);
  }
  await page.waitForTimeout(2500);

  // The open editor shows the NEWEST generation, not a frozen earlier one.
  const ids = await getSceneElementIds(filePath);
  expect(ids.sort()).toEqual(['agent-rect-1', 'agent-rect-2', 'agent-rect-3', 'seed-rect']);

  // Exactly one resolution: one pre-edit tag, nothing left pending.
  const tags: Array<{ type: string; status: string }> = await page.evaluate(
    (fp) => (window as any).electronAPI.invoke('history:get-all-tags', fp), filePath,
  );
  expect(tags.filter((t) => t.type === 'pre-edit')).toHaveLength(1);
  expect(tags.filter((t) => t.status === 'pending-review')).toHaveLength(0);

  // Disk holds the newest generation -- no auto-accept wrote an older one back.
  const diskIds = (JSON.parse(await fs.readFile(filePath, 'utf8')).elements || [])
    .map((e: { id: string }) => e.id).sort();
  expect(diskIds).toEqual(['agent-rect-1', 'agent-rect-2', 'agent-rect-3', 'seed-rect']);
});

// Phase 6 (remove the 50ms custom-editor registration delay).
//
// `checkAndApplyPendingDiffs` sleeps 50ms hoping the custom editor registered
// its diff callback. The replacement makes callback registration itself the
// readiness signal: a generation with no capable presenter stays
// `awaiting-presenter` and is delivered the moment a presenter registers,
// however late that is. This test opens a file that ALREADY has a pending diff
// (no watcher event follows), so the only way the editor can learn about it is
// that replay -- which is what the 50ms guess is standing in for today.
test('custom editor registering after mount still receives the pending generation', async () => {
  test.setTimeout(120_000);
  const filePath = path.join(workspaceDir, LATE_REGISTRATION_FILE_NAME);
  const baseline = excalidrawFile([makeRect('seed-rect', 10)]);
  const agentContent = excalidrawFile([makeRect('seed-rect', 10), makeRect('late-rect', 200)]);

  // Tag + agent write happen while the file is CLOSED, so there is no
  // file-changed event for the editor to ride in on.
  await fs.writeFile(filePath, baseline, 'utf8');
  await page.evaluate(async ({ workspacePath, fp, content }) => {
    await (window as any).electronAPI.history.createTag(
      workspacePath, fp, 'late-registration-tag', content, 'late-registration-session', 'tool-late-reg',
    );
  }, { workspacePath: workspaceDir, fp: filePath, content: baseline });
  await fs.writeFile(filePath, agentContent, 'utf8');
  await page.waitForTimeout(300);

  await switchToFilesMode(page);
  await openFileFromTree(page, LATE_REGISTRATION_FILE_NAME);
  await expect(
    page.locator(`[data-file-path="${filePath}"].multi-editor-instance .excalidraw-editor`)
  ).toBeVisible({ timeout: TEST_TIMEOUTS.EDITOR_LOAD });

  // The generation reaches the editor regardless of registration timing.
  await expect.poll(() => getSceneElementIds(filePath), { timeout: 10000 })
    .toContain('late-rect');

  // Auto-accept resolved the pending review exactly once and disk is untouched.
  const tags: Array<{ type: string; status: string }> = await page.evaluate(
    (fp) => (window as any).electronAPI.invoke('history:get-all-tags', fp), filePath,
  );
  expect(tags.filter((t) => t.status === 'pending-review')).toHaveLength(0);
  expect(await fs.readFile(filePath, 'utf8')).toBe(agentContent);
});
