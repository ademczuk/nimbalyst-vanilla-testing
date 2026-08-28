/**
 * Tip: Animation Discovery
 *
 * Surfaces the Animation editor to active AI users. Heavy tool-use sessions
 * imply the user is working on something with moving parts -- a request path,
 * a pipeline, a retry -- which is exactly what a static diagram explains worst.
 *
 * Deliberately not gated on "has never opened an .anim.json": discovery tips
 * stay in the rotation rather than disappearing after a single use. Dismissal
 * is what takes a tip out.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { FEATURE_USAGE_KEYS } from '../../../shared/featureUsage';
import type { TipDefinition } from '../types';

const AnimationIcon = <MaterialSymbol icon="animation" size={16} />;

export const animationDiscoverTip: TipDefinition = {
  id: 'tip-animation-discover',
  name: 'Animation Discovery',
  version: 1,
  trigger: {
    screen: '*',
    condition: (context) =>
      context.hasReachedCount(FEATURE_USAGE_KEYS.SESSION_COMPLETED_WITH_TOOLS, 5),
    delay: 2000,
    priority: 4,
  },
  content: {
    icon: AnimationIcon,
    title: 'Animate the part that only makes sense moving',
    body: 'Create an **.anim.json** file to build an explainer that plays: a request crossing a cache, a queue draining, a retry after a timeout.\n\nYou write steps, not keyframes, so the agent can author and edit the whole thing as plain JSON.',
    action: {
      label: 'Ask the agent to animate',
      insertPrompt: 'Create an animated explainer diagram of ',
    },
  },
};
