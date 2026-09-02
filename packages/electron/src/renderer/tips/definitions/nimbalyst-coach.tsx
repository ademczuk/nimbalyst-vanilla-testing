/**
 * Tip: Nimbalyst Coach
 *
 * Surfaces the /planning:nimbalyst-coach workflow to users with real session history
 * whose workspace still shows a major surrounding feature untouched.
 *
 * The gap this closes is invisible from the inside: you cannot know which
 * feature you failed to use. Every other tip teaches one feature; this one
 * points at the command that reads the user's own project and sessions and
 * tells them which features their actual work was missing.
 *
 * Gated on trackers OR worktrees never being used so that someone already
 * exercising the whole product never sees it.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { FEATURE_USAGE_KEYS } from '../../../shared/featureUsage';
import type { TipDefinition } from '../types';

const CoachIcon = <MaterialSymbol icon="insights" size={16} />;

export const nimbalystCoachTip: TipDefinition = {
  id: 'tip-nimbalyst-coach',
  name: 'Nimbalyst Coach',
  version: 1,
  trigger: {
    // 'agent' so the insertPrompt action has a composer to drop into.
    screen: 'agent',
    condition: (context) =>
      context.hasReachedCount(FEATURE_USAGE_KEYS.SESSION_CREATED, 25) &&
      (!context.hasBeenUsed(FEATURE_USAGE_KEYS.TRACKER_USED) ||
        !context.hasBeenUsed(FEATURE_USAGE_KEYS.WORKTREE_CREATED)),
    delay: 2500,
    priority: 5,
  },
  content: {
    icon: CoachIcon,
    title: 'Find out what you are missing',
    body: 'Your agent can read this project and your recent sessions and tell you what would make them go better -- **extensions** that match your files, features you have not touched, and **instructions** worth adding so every future session starts smarter.',
    action: {
      label: 'Show me',
      // Drops the command into the composer (claude-code sessions only).
      // Extension commands are namespaced by their plugin, so the name the
      // user actually types is `/planning:nimbalyst-coach` -- the bare form
      // does not resolve.
      insertPrompt: '/planning:nimbalyst-coach ',
      variant: 'primary',
    },
  },
};
