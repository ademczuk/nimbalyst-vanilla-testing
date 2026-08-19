/**
 * AI Sessions Walkthrough
 *
 * Introduces the session control in the unified editor header. It targets the
 * control's wrapper, not the sparkle button, because the trigger renders as a
 * session chip once the document has a linked session -- targeting the button
 * would silently stop the walkthrough from ever showing on those documents.
 */

import type { WalkthroughDefinition } from '../types';
import { getHelpContent } from '../../help';
import { isTargetValid } from '../WalkthroughService';

const aiSessionsHelp = getHelpContent('document-session-control')!;

export const aiSessionsButton: WalkthroughDefinition = {
  id: 'ai-sessions-button',
  name: 'AI Sessions Button',
  version: 1,
  trigger: {
    // Show when in files mode (editor is visible)
    screen: 'files',
    // Only show when the AI sessions button is visible AND not in diff mode
    condition: () => {
      const control = document.querySelector('[data-testid="document-session-control"]');
      if (!control || !isTargetValid(control as HTMLElement)) return false;

      // Don't show if in diff mode (unified diff header or monaco diff approval bar visible)
      const unifiedDiffHeader = document.querySelector('.unified-diff-header');
      const monacoDiffBar = document.querySelector('.monaco-diff-approval-bar');
      if (unifiedDiffHeader || monacoDiffBar) return false;

      return true;
    },
    // Delay to let the editor fully load
    delay: 1500,
    // Higher priority than agent-mode-intro since this is more contextual
    priority: 20,
  },
  steps: [
    {
      id: 'ai-sessions-intro',
      target: {
        testId: 'document-session-control',
      },
      title: aiSessionsHelp.title,
      body: aiSessionsHelp.body,
      shortcut: aiSessionsHelp.shortcut,
      placement: 'bottom',
    },
  ],
};
