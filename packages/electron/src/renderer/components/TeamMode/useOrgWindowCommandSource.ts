import { useEffect } from 'react';

import {
  ORG_WINDOW_COMMAND_CHANNEL,
  isOrgWindowCommand,
} from '../../../shared/orgWindowCommands';
import { dispatchOrgWindowCommand } from './orgWindowCommandBus';
import { resolveOrgWindowCommand } from './orgWindowKeyboard';
import type { OrgModeChrome } from './orgModeTypes';

/**
 * The org window's single publisher of messaging commands.
 *
 * Mounted by `TeamManagementApp` — the window root — rather than inside
 * `TeamMode`, so the keys work on every surface the window can show, including
 * the loading and unbound-organization arms. Both sources land on the same bus:
 * the native Messages menu over IPC, and the window's own key handling for the
 * platforms and moments the menu accelerator does not reach.
 *
 * Org mode inside a project window does not mount this: that window already
 * owns Cmd+K (Agent mode), Cmd+F (Find) and Cmd+I (italic). `chrome` is passed
 * through to the resolver so that if a project surface ever does mount it, the
 * chords the window owns cannot be taken.
 */
export function useOrgWindowCommandSource(
  surfaceId: string,
  chrome: OrgModeChrome = 'window',
): void {
  useEffect(() => {
    const off = window.electronAPI?.on?.(
      ORG_WINDOW_COMMAND_CHANNEL,
      (command: unknown) => {
        if (isOrgWindowCommand(command)) {
          dispatchOrgWindowCommand(surfaceId, command);
        }
      },
    );
    return () => { off?.(); };
  }, [surfaceId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = resolveOrgWindowCommand(event, undefined, chrome);
      if (!command) return;
      // Nothing else in this window claims these combinations, and letting
      // Cmd+F fall through would hand the page Chromium's own find bar.
      event.preventDefault();
      dispatchOrgWindowCommand(surfaceId, command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chrome, surfaceId]);
}
