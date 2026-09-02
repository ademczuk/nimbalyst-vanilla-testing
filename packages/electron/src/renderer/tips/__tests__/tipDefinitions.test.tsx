// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../store';
import { DIALOG_IDS } from '../../dialogs/registry';
import { dialogRef } from '../../contexts/DialogContext';
import { windowModeAtom } from '../../store/atoms/windowMode';
import { openSettingsCommandAtom } from '../../store/atoms/settingsNavigation';
import { organizationDirectoryAtom, type OrganizationDirectoryEntry } from '../../store/atoms/settingsDomains';
import { FEATURE_USAGE_KEYS, type FeatureUsageKey, type FeatureUsageRecord } from '../../../shared/featureUsage';
import { tipCreateWorktreeSessionRequestAtom } from '../atoms';
import { agentDiagramTip } from '../definitions/agent-diagram';
import { animationDiscoverTip } from '../definitions/animation-discover';
import { canvasDiscoverTip } from '../definitions/canvas-discover';
import { datamodelDiscoverTip } from '../definitions/datamodel-discover';
import { excalidrawDiscoverTip } from '../definitions/excalidraw-discover';
import { keyboardShortcutsTip } from '../definitions/keyboard-shortcuts';
import { mockupDiscoverTip } from '../definitions/mockup-discover';
import { spreadsheetDiscoverTip } from '../definitions/spreadsheet-discover';
import { nimbalystCoachTip } from '../definitions/nimbalyst-coach';
import { sessionCleanupTip } from '../definitions/session-cleanup';
import { sessionLaunchShortcutTip } from '../definitions/session-launch-shortcut';
import { filesAgentContextTip } from '../definitions/files-agent-context';
import { filesVisualEditorsTip } from '../definitions/files-visual-editors';
import { themeExploreTip } from '../definitions/theme-explore';
import { trackerModeTip } from '../definitions/tracker-mode';
import { teamsMultiplayerTip } from '../definitions/teams-multiplayer';
import { worktreeSessionTip } from '../definitions/worktree-session';
import type { TipTriggerContext } from '../types';

function createFeatureUsage(
  counts: Partial<Record<FeatureUsageKey, number>> = {},
): Record<string, FeatureUsageRecord> {
  const timestamp = '2026-05-22T00:00:00.000Z';

  return Object.fromEntries(
    Object.entries(counts).map(([feature, count]) => [
      feature,
      {
        count,
        firstUsed: timestamp,
        lastUsed: timestamp,
      },
    ]),
  );
}

function createContext(
  overrides: Partial<TipTriggerContext> = {},
): TipTriggerContext {
  const featureUsage = overrides.featureUsage ?? createFeatureUsage();
  const toolUsage = overrides.toolUsage ?? {};

  return {
    currentMode: 'files',
    workspacePath: '/repo',
    isGitRepo: false,
    isWorktreesAvailable: false,
    featureUsage,
    hasBeenUsed: (feature) => (featureUsage[feature]?.count ?? 0) > 0,
    hasReachedCount: (feature, threshold) => (featureUsage[feature]?.count ?? 0) >= threshold,
    toolUsage,
    hasUsedTool: (toolKey) => (toolUsage[toolKey]?.count ?? 0) > 0,
    toolUseCount: (toolKey) => toolUsage[toolKey]?.count ?? 0,
    ...overrides,
  };
}

describe('contextual tip definitions', () => {
  beforeEach(() => {
    store.set(windowModeAtom, 'files');
    store.set(openSettingsCommandAtom, null);
    store.set(organizationDirectoryAtom, []);
    store.set(tipCreateWorktreeSessionRequestAtom, 0);
    dialogRef.current = {
      open: vi.fn(),
      close: vi.fn(),
      isOpen: vi.fn(),
      activeDialogs: [],
      confirm: vi.fn(),
      registerDialog: vi.fn(),
    };
  });

  it('shows the tracker tip only after repeated sessions without tracker usage', () => {
    const eligible = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_CREATED]: 5,
      }),
    });
    const alreadyUsedTracker = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_CREATED]: 8,
        [FEATURE_USAGE_KEYS.TRACKER_USED]: 1,
      }),
    });

    expect(trackerModeTip.trigger.condition(eligible)).toBe(true);
    expect(trackerModeTip.trigger.condition(alreadyUsedTracker)).toBe(false);
  });

  it('opens tracker mode from the tracker tip action', () => {
    trackerModeTip.content.action?.onClick?.();

    expect(store.get(windowModeAtom)).toBe('tracker');
  });

  it('shows the shortcuts tip only after repeated launches without shortcut usage', () => {
    const eligible = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.APP_LAUNCH]: 7,
      }),
    });
    const alreadyUsedShortcut = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.APP_LAUNCH]: 10,
        [FEATURE_USAGE_KEYS.KEYBOARD_SHORTCUT_USED]: 1,
      }),
    });

    expect(keyboardShortcutsTip.trigger.condition(eligible)).toBe(true);
    expect(keyboardShortcutsTip.trigger.condition(alreadyUsedShortcut)).toBe(false);
  });

  it('opens the keyboard shortcuts dialog from the shortcuts tip action', () => {
    keyboardShortcutsTip.content.action?.onClick?.();

    expect(dialogRef.current?.open).toHaveBeenCalledWith(DIALOG_IDS.KEYBOARD_SHORTCUTS, {});
  });

  it('shows the session launch shortcut tip to established session users without shortcut usage', () => {
    const eligible = createContext({
      currentMode: 'agent',
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_CREATED]: 3,
      }),
    });
    const newUser = createContext({
      currentMode: 'agent',
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_CREATED]: 2,
      }),
    });
    const alreadyUsedShortcut = createContext({
      currentMode: 'agent',
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_CREATED]: 5,
        [FEATURE_USAGE_KEYS.KEYBOARD_SHORTCUT_USED]: 1,
      }),
    });

    expect(sessionLaunchShortcutTip.trigger.screen).toBe('agent');
    expect(sessionLaunchShortcutTip.trigger.condition(eligible)).toBe(true);
    expect(sessionLaunchShortcutTip.trigger.condition(newUser)).toBe(false);
    expect(sessionLaunchShortcutTip.trigger.condition(alreadyUsedShortcut)).toBe(false);
  });

  it('shows the theme tip only after repeated launches without a theme change', () => {
    const eligible = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.APP_LAUNCH]: 5,
      }),
    });
    const alreadyChangedTheme = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.APP_LAUNCH]: 9,
        [FEATURE_USAGE_KEYS.THEME_CHANGED]: 1,
      }),
    });

    expect(themeExploreTip.trigger.condition(eligible)).toBe(true);
    expect(themeExploreTip.trigger.condition(alreadyChangedTheme)).toBe(false);
  });

  it('opens themes settings from the theme tip action', () => {
    themeExploreTip.content.action?.onClick?.();

    expect(store.get(openSettingsCommandAtom)).toMatchObject({
      category: 'themes',
    });
  });

  it('shows the worktree tip only for established git workspaces outside an existing worktree', () => {
    const eligible = createContext({
      currentMode: 'agent',
      workspacePath: '/repo',
      isGitRepo: true,
      isWorktreesAvailable: true,
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_CREATED]: 10,
      }),
    });
    const alreadyInWorktree = createContext({
      currentMode: 'agent',
      workspacePath: '/repo/_worktrees/topic-branch',
      isGitRepo: true,
      isWorktreesAvailable: true,
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_CREATED]: 12,
      }),
    });

    expect(worktreeSessionTip.trigger.condition(eligible)).toBe(true);
    expect(worktreeSessionTip.trigger.condition(alreadyInWorktree)).toBe(false);
  });

  it('requests a worktree session from the worktree tip action', () => {
    worktreeSessionTip.content.action?.onClick?.();

    expect(store.get(windowModeAtom)).toBe('agent');
    expect(store.get(tipCreateWorktreeSessionRequestAtom)).toBe(1);
  });

  it('shows the session cleanup tip only once the board has accumulated many sessions', () => {
    const fewSessions = createContext({
      currentMode: 'agent',
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_CREATED]: 10,
      }),
    });
    const manySessions = createContext({
      currentMode: 'agent',
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_CREATED]: 20,
      }),
    });

    expect(sessionCleanupTip.trigger.condition(fewSessions)).toBe(false);
    expect(sessionCleanupTip.trigger.condition(manySessions)).toBe(true);
  });

  it('inserts the /session-cleanup command from the session cleanup tip action', () => {
    expect(sessionCleanupTip.content.action?.insertPrompt).toBe('/session-cleanup ');
  });

  it('offers the coach only to established users still missing a major feature', () => {
    const agent = (featureUsage: Record<string, number>) =>
      createContext({ currentMode: 'agent', featureUsage: createFeatureUsage(featureUsage) });

    // Too little history for the coach to have evidence to work from.
    expect(
      nimbalystCoachTip.trigger.condition(
        agent({ [FEATURE_USAGE_KEYS.SESSION_CREATED]: 10 }),
      ),
    ).toBe(false);

    // Real history, and trackers never touched.
    expect(
      nimbalystCoachTip.trigger.condition(
        agent({
          [FEATURE_USAGE_KEYS.SESSION_CREATED]: 25,
          [FEATURE_USAGE_KEYS.WORKTREE_CREATED]: 3,
        }),
      ),
    ).toBe(true);

    // Already using trackers and worktrees -- they know the product; don't
    // spend their one tip slot telling them to go find out what they're missing.
    expect(
      nimbalystCoachTip.trigger.condition(
        agent({
          [FEATURE_USAGE_KEYS.SESSION_CREATED]: 40,
          [FEATURE_USAGE_KEYS.TRACKER_USED]: 5,
          [FEATURE_USAGE_KEYS.WORKTREE_CREATED]: 2,
        }),
      ),
    ).toBe(false);
  });

  it('inserts the coach command under its plugin namespace', () => {
    // Extension commands only resolve as `/<plugin>:<command>`; the bare name
    // silently does nothing when the user submits it.
    expect(nimbalystCoachTip.content.action?.insertPrompt).toBe('/planning:nimbalyst-coach ');
  });

  it('targets the welcome tips to the files-empty surface', () => {
    expect(filesVisualEditorsTip.trigger.screen).toBe('files-empty');
    expect(filesAgentContextTip.trigger.screen).toBe('files-empty');
    expect(filesVisualEditorsTip.trigger.condition(createContext())).toBe(true);
    expect(filesAgentContextTip.trigger.condition(createContext())).toBe(true);
  });

  it('shows the Teams tip to established users who are in no organization', () => {
    const eligible = createContext({
      featureUsage: createFeatureUsage({ [FEATURE_USAGE_KEYS.SESSION_CREATED]: 5 }),
    });
    const newUser = createContext({
      featureUsage: createFeatureUsage({ [FEATURE_USAGE_KEYS.SESSION_CREATED]: 4 }),
    });

    expect(teamsMultiplayerTip.trigger.screen).toEqual(['files-empty', 'agent']);
    expect(teamsMultiplayerTip.trigger.condition(eligible)).toBe(true);
    expect(teamsMultiplayerTip.trigger.condition(newUser)).toBe(false);

    store.set(organizationDirectoryAtom, [
      { orgId: 'org-1', name: 'Acme', role: 'admin' } as OrganizationDirectoryEntry,
    ]);
    expect(teamsMultiplayerTip.trigger.condition(eligible)).toBe(false);
  });

  it('opens project sharing settings from the Teams tip action', () => {
    teamsMultiplayerTip.content.action?.onClick?.();

    expect(store.get(openSettingsCommandAtom)).toMatchObject({
      category: 'project-sharing',
      scope: 'project',
    });
  });

  it('seeds a visual-editor prompt from the welcome tip action', () => {
    expect(filesVisualEditorsTip.content.action?.insertPrompt).toBe(
      'Create a visual mockup for ',
    );
  });

  it('shows the animation and canvas tips to established tool users', () => {
    const eligible = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_COMPLETED_WITH_TOOLS]: 5,
      }),
    });
    const newUser = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_COMPLETED_WITH_TOOLS]: 4,
      }),
    });

    expect(animationDiscoverTip.trigger.condition(eligible)).toBe(true);
    expect(animationDiscoverTip.trigger.condition(newUser)).toBe(false);
    expect(canvasDiscoverTip.trigger.condition(eligible)).toBe(true);
    expect(canvasDiscoverTip.trigger.condition(newUser)).toBe(false);
  });

  it('keeps editor-discovery tips in the rotation after the editor has been used', () => {
    // Discovery tips are recurring rotation content, not one-shot onboarding:
    // using the editor must not retire the tip. Dismissal is the only thing
    // that takes one out, and that is enforced by TipService, not the trigger.
    const heavyUser = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_COMPLETED_WITH_TOOLS]: 50,
        [FEATURE_USAGE_KEYS.EXCALIDRAW_OPENED]: 30,
        [FEATURE_USAGE_KEYS.MOCKUP_OPENED]: 30,
        [FEATURE_USAGE_KEYS.SPREADSHEET_OPENED]: 30,
        [FEATURE_USAGE_KEYS.DATAMODEL_OPENED]: 30,
      }),
    });

    expect(animationDiscoverTip.trigger.condition(heavyUser)).toBe(true);
    expect(canvasDiscoverTip.trigger.condition(heavyUser)).toBe(true);
    expect(excalidrawDiscoverTip.trigger.condition(heavyUser)).toBe(true);
    expect(mockupDiscoverTip.trigger.condition(heavyUser)).toBe(true);
    expect(spreadsheetDiscoverTip.trigger.condition(heavyUser)).toBe(true);
    expect(datamodelDiscoverTip.trigger.condition(heavyUser)).toBe(true);
  });

  it('shows the agent-diagram tip once the agent has still never driven Excalidraw', () => {
    // Regression: this tip also required hasBeenUsed(EXCALIDRAW_OPENED), a key
    // nothing records, so the condition was permanently false and the card
    // could never appear. The MCP-tool gate is wired and stays.
    const eligible = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_COMPLETED_WITH_TOOLS]: 8,
      }),
    });
    const agentAlreadyDrew = createContext({
      featureUsage: createFeatureUsage({
        [FEATURE_USAGE_KEYS.SESSION_COMPLETED_WITH_TOOLS]: 8,
      }),
      toolUsage: {
        'mcp:nimbalyst-excalidraw': {
          count: 1,
          firstUsed: '2026-05-22T00:00:00.000Z',
          lastUsed: '2026-05-22T00:00:00.000Z',
        },
      },
    });

    expect(agentDiagramTip.trigger.condition(eligible)).toBe(true);
    expect(agentDiagramTip.trigger.condition(agentAlreadyDrew)).toBe(false);
  });
});
