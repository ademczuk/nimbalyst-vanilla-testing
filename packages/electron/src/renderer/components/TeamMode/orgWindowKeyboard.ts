import type { OrgWindowCommand } from '../../../shared/orgWindowCommands';
import type { OrgModeChrome } from './orgModeTypes';

/**
 * The org window's local resolution of the Messages accelerators.
 *
 * The native menu already owns these keys while this window is focused, and on
 * macOS a menu accelerator consumes the event before the renderer sees it — so
 * in practice this handles the cases the menu cannot: Windows and Linux, where
 * the strip is hidden behind the custom title bar, and any moment the menu has
 * not been rebuilt for the current focus yet. Firing twice is harmless: every
 * command is idempotent (open a dialog that is open, route where you already
 * are).
 *
 * Bracket keys are matched on `event.code` because Shift turns `]` into `}`;
 * letters are matched on `event.key` so non-QWERTY layouts keep working.
 */
export interface OrgWindowKeyEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * Chords the project window already owns, and which Org mode must therefore
 * never claim: Cmd+K is Agent mode, Cmd+F is Find, Cmd+I is the editor's
 * italic. The standalone window can bind all three because it has no content
 * modes and no editor to take them from.
 */
const PROJECT_WINDOW_OWNED_COMMANDS: ReadonlySet<OrgWindowCommand> = new Set([
  'newMessage',
  'searchMessages',
  'goToInbox',
]);

export function resolveOrgWindowCommand(
  event: OrgWindowKeyEvent,
  isMac: boolean = typeof navigator !== 'undefined'
    && navigator.platform.startsWith('Mac'),
  chrome: OrgModeChrome = 'window',
): OrgWindowCommand | null {
  const command = resolveChord(event, isMac);
  if (command && chrome === 'mode' && PROJECT_WINDOW_OWNED_COMMANDS.has(command)) {
    return null;
  }
  return command;
}

function resolveChord(
  event: OrgWindowKeyEvent,
  isMac: boolean,
): OrgWindowCommand | null {
  // The platform's own accelerator modifier, and only it. Cmd+Ctrl+K is a
  // different shortcut than Cmd+K and must not be swallowed here.
  const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primary || event.altKey) return null;

  const letter = event.key.length === 1 ? event.key.toLowerCase() : '';

  if (event.shiftKey) {
    if (letter === 'u') return 'markAllRead';
    if (event.code === 'BracketRight') return 'nextConversation';
    if (event.code === 'BracketLeft') return 'previousConversation';
    return null;
  }

  if (letter === 'k') return 'newMessage';
  if (letter === 'f') return 'searchMessages';
  if (letter === 'i') return 'goToInbox';
  return null;
}
