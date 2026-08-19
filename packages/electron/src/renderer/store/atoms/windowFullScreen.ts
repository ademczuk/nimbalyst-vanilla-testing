/**
 * Window Fullscreen Atom
 *
 * True while the window is in OS fullscreen. The custom title bar reads it to
 * draw its own exit control: fullscreen takes the OS window controls away, so
 * without it there is nothing visible to click to get back out.
 *
 * Written by store/listeners/windowFullScreenListeners.ts. Components read it;
 * they never subscribe to the IPC event themselves.
 */

import { atom } from 'jotai';

export const windowFullScreenAtom = atom(false);
