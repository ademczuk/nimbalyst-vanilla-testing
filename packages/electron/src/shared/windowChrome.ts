export const MAIN_WINDOW_TITLE_BAR_HEIGHT = 38;

/**
 * Fullscreen state channels for the custom title bar.
 *
 * The OS window controls are gone in fullscreen, so the bar has to draw its own
 * way out; it needs to know when the window entered fullscreen to do that.
 */
export const WINDOW_FULL_SCREEN_CHANNELS = {
  get: 'window-chrome:get-full-screen',
  changed: 'window-chrome:full-screen-changed',
  exit: 'window-chrome:exit-full-screen',
} as const;

export interface TitleBarOverlayColors {
  color: string;
  symbolColor: string;
}

const MAX_CSS_COLOR_LENGTH = 64;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{3,8}$/i;
const NAMED_COLOR_PATTERN = /^[a-z]{1,24}$/i;
const FUNCTION_COLOR_PATTERN = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9a-z.,%+\-/\s]+\)$/i;

function isShortCssColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CSS_COLOR_LENGTH) return false;
  return HEX_COLOR_PATTERN.test(trimmed)
    || NAMED_COLOR_PATTERN.test(trimmed)
    || FUNCTION_COLOR_PATTERN.test(trimmed);
}

export function isTitleBarOverlayColors(value: unknown): value is TitleBarOverlayColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isShortCssColor(candidate.color) && isShortCssColor(candidate.symbolColor);
}

/**
 * What the renderer reports once it has actually applied a theme.
 *
 * `backgroundColor` is the resolved `--nim-bg`. Main persists it so the *next*
 * launch can paint the window canvas in the real theme colour before any CSS
 * parses. Without it, extension and file-based themes are collapsed to a base
 * light/dark colour at window-creation time (their colours only exist inside
 * the renderer's theme registry), so a light extension theme opens white and
 * repaints once React resolves it.
 *
 * Kept separate from TitleBarOverlayColors because that object is handed
 * straight to Electron's setTitleBarOverlay, which takes no such field.
 */
export interface ResolvedThemeChrome extends TitleBarOverlayColors {
  backgroundColor?: string;
}

/** Narrow an untrusted IPC value to a short, well-formed CSS colour. */
export function readCssColor(value: unknown): string | undefined {
  return isShortCssColor(value) ? value.trim() : undefined;
}
