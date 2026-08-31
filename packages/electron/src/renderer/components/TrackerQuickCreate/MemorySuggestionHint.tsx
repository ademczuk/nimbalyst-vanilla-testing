/**
 * Offer to turn on semantic duplicate matching, at the moment the benefit is
 * concrete: the reader is looking at a list of same-wording matches and can be
 * told that fuzzier matching would also catch differently-worded duplicates.
 *
 * Two constraints, both deliberate:
 *  - Dismissable for good. This popup is designed to be opened dozens of times
 *    a day; a prompt that returns on every open is a nag.
 *  - Honest about the cost. Enabling the memory extension sends tracker titles
 *    and bodies to OpenAI for embedding, billed to the user's own key. It is
 *    not free and the prompt says so.
 *
 * No API key is ever read from `process.env` in this flow — the user configures
 * one in settings or the feature stays off.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import { openSettingsCommandAtom } from '../../store/atoms/settingsNavigation';

const MEMORY_EXTENSION_ID = 'nimbalyst-memory';
const DISMISSED_SETTINGS_KEY = 'trackerQuickCreateMemoryHintDismissed';

export const MemorySuggestionHint: React.FC<{ workspacePath: string }> = ({ workspacePath }) => {
  const [dismissed, setDismissed] = useState(true);
  const openSettings = useSetAtom(openSettingsCommandAtom);

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI
      ?.settingsGetAll?.()
      .then((settings: Record<string, unknown> | undefined) => {
        const record = settings?.[DISMISSED_SETTINGS_KEY];
        const isDismissed = Boolean(
          record && typeof record === 'object' && (record as Record<string, boolean>)[workspacePath],
        );
        if (!cancelled) setDismissed(isDismissed);
      })
      .catch(() => {
        if (!cancelled) setDismissed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    void window.electronAPI
      ?.settingsGetAll?.()
      .then((settings: Record<string, unknown> | undefined) => {
        const existing = settings?.[DISMISSED_SETTINGS_KEY];
        const next = {
          ...(existing && typeof existing === 'object' ? (existing as Record<string, boolean>) : {}),
          [workspacePath]: true,
        };
        return window.electronAPI.settingsSet(DISMISSED_SETTINGS_KEY, next);
      })
      .catch(() => {
        // Non-fatal: the hint reappears next open rather than being lost.
      });
  }, [workspacePath]);

  const handleEnable = useCallback(() => {
    handleDismiss();
    void window.electronAPI.extensions
      .setEnabled(MEMORY_EXTENSION_ID, true)
      .catch(() => {
        // The settings screen below is where the user finishes the setup anyway.
      });
    openSettings({ category: 'installed-extensions', timestamp: Date.now() });
  }, [handleDismiss, openSettings]);

  if (dismissed) return null;

  return (
    <div className="tracker-quick-create-memory-hint mt-2 flex items-start gap-2 border-t border-[var(--nim-border)] pt-2 text-[11px] text-[var(--nim-text-muted)]">
      <span className="flex-1">
        These matches share your wording. Project Memory also catches duplicates worded
        differently — it embeds tracker titles and bodies with OpenAI, billed to your own API key.
      </span>
      <button
        type="button"
        data-testid="tracker-quick-create-enable-memory"
        className="shrink-0 rounded px-1.5 py-0.5 text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
        onClick={handleEnable}
      >
        Turn on
      </button>
      <button
        type="button"
        data-testid="tracker-quick-create-dismiss-memory"
        className="shrink-0 rounded px-1.5 py-0.5 hover:bg-[var(--nim-bg-hover)]"
        onClick={handleDismiss}
      >
        Not now
      </button>
    </div>
  );
};

export default MemorySuggestionHint;
