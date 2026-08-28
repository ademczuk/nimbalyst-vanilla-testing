/**
 * Tip: Project Canvas Discovery
 *
 * Surfaces Project Canvas to active AI users. The pitch is the thing that
 * separates it from a whiteboard: cards mount the real editor for the file
 * they point at, so a board cannot drift from the work it describes.
 *
 * Deliberately not gated on "has never opened a .canvas": discovery tips stay
 * in the rotation rather than disappearing after a single use. Dismissal is
 * what takes a tip out.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { FEATURE_USAGE_KEYS } from '../../../shared/featureUsage';
import type { TipDefinition } from '../types';

const CanvasIcon = <MaterialSymbol icon="dashboard" size={16} />;

export const canvasDiscoverTip: TipDefinition = {
  id: 'tip-canvas-discover',
  name: 'Project Canvas Discovery',
  version: 1,
  trigger: {
    screen: '*',
    condition: (context) =>
      context.hasReachedCount(FEATURE_USAGE_KEYS.SESSION_COMPLETED_WITH_TOOLS, 5),
    delay: 2000,
    priority: 4,
  },
  content: {
    icon: CanvasIcon,
    title: 'Lay your real files out on one board',
    body: 'A **.canvas** board holds cards that mount the actual editor for the file they point at -- the mockup renders, the spreadsheet shows real numbers, the document is editable in place.\n\nDescribe the board you want and the agent arranges it, wired with edges.',
    action: {
      label: 'Ask the agent for a board',
      insertPrompt: 'Create a canvas board laying out ',
    },
  },
};
