/**
 * Tip: Teams Multiplayer
 *
 * Introduces Teams to active users who are not in an organization yet, on both
 * the Files empty state and the empty session transcript.
 *
 * The condition reads the org directory rather than a feature-usage key: there
 * is no local usage signal for "joined an org", and the directory is hydrated
 * at startup by stytchAuthListeners (it stays empty for signed-out users, who
 * are also part of the target audience).
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { store } from '@nimbalyst/runtime/store';
import { FEATURE_USAGE_KEYS } from '../../../shared/featureUsage';
import { organizationDirectoryAtom } from '../../store/atoms/settingsDomains';
import { openSettingsCommandAtom } from '../../store/atoms/settingsNavigation';
import type { TipDefinition } from '../types';

const TEAMS_URL = 'https://nimbalyst.com/teams';

const GroupsIcon = <MaterialSymbol icon="groups" size={16} />;

export const teamsMultiplayerTip: TipDefinition = {
  id: 'tip-teams-multiplayer',
  name: 'Teams Multiplayer Workspace',
  version: 1,
  trigger: {
    screen: ['files-empty', 'agent'],
    condition: (context) =>
      context.hasReachedCount(FEATURE_USAGE_KEYS.SESSION_CREATED, 5) &&
      store.get(organizationDirectoryAtom).length === 0,
    delay: 2500,
    priority: 8,
  },
  content: {
    icon: GroupsIcon,
    title: 'Make this workspace multiplayer',
    body:
      "With **Teams**, your docs, mockups, diagrams, and trackers can be shared. Teammates edit the same files live or asynch, and each teammate's local agent works on those same shared artifacts. Promote any local file to shared in a click or create a new shared file. "
      + `See how Teams works ${TEAMS_URL}`,
    action: {
      label: 'Create an Organization',
      onClick: () => {
        store.set(openSettingsCommandAtom, {
          category: 'project-sharing',
          scope: 'project',
          timestamp: Date.now(),
        });
      },
      variant: 'primary',
    },
    secondaryAction: {
      label: 'See how Teams works',
      onClick: () => {
        void window.electronAPI?.openExternal(TEAMS_URL);
      },
      variant: 'link',
    },
  },
};
