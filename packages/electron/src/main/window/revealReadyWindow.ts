import { isStartupCohortWindow, notifyStartupWindowRevealed } from './StartupActivation';
import { logger } from '../utils/logger';

export interface RevealableWindow {
    readonly id?: number;
    show(): void;
    showInactive(): void;
    focus(): void;
    maximize(): void;
    isDestroyed(): boolean;
    once(event: 'closed', listener: () => void): unknown;
    removeListener(event: 'closed', listener: () => void): unknown;
}

export interface RevealOptions {
    showInactive?: boolean;
    /**
     * This window was created during startup. It is revealed without activating
     * the app; StartupActivation foregrounds the app once at the end of launch.
     */
    startupReveal?: boolean;
}

/**
 * Reveal a ready-to-show window.
 *
 * A startup-cohort window always uses showInactive() so a late ready-to-show
 * cannot yank focus away from whatever the user switched to during a long load.
 * It is still shown immediately — never withheld — and the one-time
 * foregrounding at the end of startup brings the app forward.
 *
 * maximize() runs after the show it belongs to: on a hidden window Electron's
 * maximize() implicitly shows the window, which would reveal (and on macOS
 * reactivate) it ahead of the intended reveal. See PR #1079 review (ghinkle).
 */
export function revealReadyWindow(
    window: RevealableWindow,
    options: RevealOptions | undefined,
    savedBounds: { isMaximized?: boolean } | undefined,
): void {
    const inStartupCohort = options?.startupReveal === true && isStartupCohortWindow(window);
    logger.main.info(
        `[startup] ready-to-show id=${window.id} startupReveal=${!!options?.startupReveal} inCohort=${inStartupCohort}`
    );

    if (inStartupCohort || options?.showInactive) {
        window.showInactive();
    } else {
        window.show();
    }

    if (savedBounds?.isMaximized) {
        window.maximize();
    }

    if (inStartupCohort) {
        notifyStartupWindowRevealed(window);
    }
}
