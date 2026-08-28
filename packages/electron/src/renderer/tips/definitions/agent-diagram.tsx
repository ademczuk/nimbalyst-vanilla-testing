/**
 * Tip: Let the agent draw the diagram
 *
 * Targets users who run heavy tool-use sessions but have never had the agent
 * drive Excalidraw via its tools. Demonstrates the per-tool usage signal
 * (`hasUsedTool`), which reads the rolled-up `mcp:<server>` key backed by the
 * tool_usage_counters table.
 *
 * This used to also require `hasBeenUsed(EXCALIDRAW_OPENED)`. Nothing has ever
 * recorded that key, so the clause was permanently false and the tip could
 * never show. `hasUsedTool` stays because the body asserts the agent has not
 * drawn one yet, which has to remain true when the card appears.
 */

import React from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { FEATURE_USAGE_KEYS } from '../../../shared/featureUsage';
import type { TipDefinition } from '../types';

const DiagramIcon = <MaterialSymbol icon="schema" size={16} />;

export const agentDiagramTip: TipDefinition = {
  id: 'tip-agent-diagram',
  name: 'Agent-driven Diagrams',
  version: 1,
  trigger: {
    screen: '*',
    condition: (context) =>
      context.hasReachedCount(FEATURE_USAGE_KEYS.SESSION_COMPLETED_WITH_TOOLS, 8) &&
      !context.hasUsedTool('mcp:nimbalyst-excalidraw'),
    delay: 2500,
    priority: 3,
  },
  content: {
    icon: DiagramIcon,
    title: 'Let the agent draw the diagram',
    body: 'The agent has never drawn a diagram for you. Ask it to sketch an architecture or a flow and it will build the Excalidraw diagram directly through its tools.',
    action: {
      label: 'Ask the agent to diagram',
      insertPrompt: 'Create an Excalidraw diagram of ',
    },
  },
};
