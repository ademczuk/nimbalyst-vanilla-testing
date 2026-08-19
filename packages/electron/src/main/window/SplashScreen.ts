import { BrowserWindow, app, nativeTheme } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { getBackgroundColor } from '../theme/ThemeManager';
import { getTheme, getThemeIsDark } from '../utils/store';

let splashWindow: BrowserWindow | null = null;

/**
 * Determine if the theme is dark (simplified version for splash screen).
 * Mirrors the logic in ThemeManager but kept local to avoid circular deps.
 */
function isDark(): boolean {
    const theme = getTheme();
    if (theme === 'light') return false;
    if (theme === 'dark') return true;
    if (theme === 'system') return nativeTheme.shouldUseDarkColors;
    // File-based themes
    return getThemeIsDark() ?? false;
}

/**
 * Get the app icon as a base64 data URL for embedding in the splash screen.
 */
function getIconDataUrl(): string | null {
    try {
        const iconPath = join(app.getAppPath(), 'icon.png');

        if (existsSync(iconPath)) {
            const iconData = readFileSync(iconPath);
            return `data:image/png;base64,${iconData.toString('base64')}`;
        }
    } catch {
        // Icon loading is best-effort
    }
    return null;
}

/**
 * Build inline HTML for the splash screen.
 * Icon is embedded as base64 data URL directly in the HTML.
 */
function buildSplashHTML(): string {
    const dark = isDark();
    const bg = dark ? '#1a1a1a' : '#ffffff';
    const textColor = dark ? '#e5e7eb' : '#374151';
    const subtextColor = dark ? '#9ca3af' : '#6b7280';
    const dotColor = dark ? '#6b7280' : '#9ca3af';
    const iconDataUrl = getIconDataUrl();

    const iconHtml = iconDataUrl
        ? `<img class="icon" src="${iconDataUrl}" alt="">`
        : '';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: ${bg};
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-app-region: drag;
    user-select: none;
    overflow: hidden;
  }
  .icon {
    width: 80px;
    height: 80px;
    margin-bottom: 24px;
    border-radius: 16px;
  }
  .title {
    font-size: 22px;
    font-weight: 600;
    color: ${textColor};
    letter-spacing: -0.3px;
    margin-bottom: 12px;
  }
  .status {
    font-size: 13px;
    color: ${subtextColor};
    display: flex;
    align-items: center;
    gap: 2px;
  }
  /* Migration progress. Hidden until the boot path calls into it, so an
     ordinary launch renders exactly as it always has. */
  #migration { display: none; width: 100%; padding: 0 30px; }
  body.migrating #migration { display: block; }
  body.migrating .status { display: none; }
  body.migrating .icon { width: 64px; height: 64px; margin-bottom: 20px; }
  body.migrating .title { font-size: 19px; margin-bottom: 6px; }
  #migration-headline {
    font-size: 12.5px; color: ${subtextColor};
    margin-bottom: 22px; text-align: center; line-height: 1.45;
  }
  #migration-track {
    width: 100%; height: 4px; border-radius: 2px;
    background: ${dark ? '#3a3a3a' : '#e5e7eb'};
    overflow: hidden;
  }
  #migration-fill {
    height: 100%; width: 0%; border-radius: 2px;
    background: #60a5fa;
    transition: width 400ms ease-out;
  }
  #migration-meta {
    display: flex; justify-content: space-between;
    margin-top: 10px; font-size: 11.5px; color: ${subtextColor};
  }
  #migration-eta { color: ${dotColor}; }
  #migration-phase {
    margin-top: 16px; text-align: center;
    font-size: 11px; color: ${dotColor};
  }
  #migration-note {
    margin-top: 18px; font-size: 10.5px; color: ${dotColor};
    text-align: center; line-height: 1.5;
  }
  .dots {
    display: inline-flex;
    gap: 3px;
    margin-left: 2px;
  }
  .dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: ${dotColor};
    animation: pulse 1.4s ease-in-out infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes pulse {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
  }
</style>
</head>
<body>
  ${iconHtml}
  <div class="title">Nimbalyst</div>
  <div class="status">Initializing<span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>
  <div id="migration">
    <div id="migration-headline">Upgrading your local database</div>
    <div id="migration-track"><div id="migration-fill"></div></div>
    <div id="migration-meta">
      <span id="migration-primary">Preparing&hellip;</span>
      <span id="migration-eta"></span>
    </div>
    <div id="migration-phase"></div>
    <div id="migration-note">This happens once. Please leave Nimbalyst open &mdash; it will restart itself when finished.</div>
  </div>
</body>
</html>`;
}

/**
 * Show the splash screen. Should be called as early as possible in app.whenReady().
 * Returns the BrowserWindow so it can be closed later.
 */
export function showSplashScreen(): BrowserWindow | null {
    if (splashWindow && !splashWindow.isDestroyed()) {
        return splashWindow;
    }

    splashWindow = new BrowserWindow({
        width: 340,
        height: 300,
        resizable: false,
        frame: false,
        backgroundColor: getBackgroundColor(),
        show: false,
        center: true,
        skipTaskbar: true,
        alwaysOnTop: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: false,
        },
    });

    const html = buildSplashHTML();
    splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    splashWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            // Use showInactive to avoid activating the app prematurely.
            // The splash has alwaysOnTop:true so it will be visible regardless.
            splashWindow.showInactive();
        }
    });

    splashWindow.on('closed', () => {
        splashWindow = null;
    });

    return splashWindow;
}

/**
 * Switch the splash into migration mode.
 *
 * The window is about to be on screen for minutes rather than a second, so it
 * has to behave like a real window: reachable from the taskbar/dock switcher
 * and not lost behind whatever the user does next. (It is already draggable —
 * the body carries `-webkit-app-region: drag`.)
 */
export function enterSplashMigrationMode(): void {
    if (!splashWindow || splashWindow.isDestroyed()) return;
    splashWindow.setSize(340, 380);
    splashWindow.center();
    splashWindow.setAlwaysOnTop(true);
    splashWindow.setSkipTaskbar(false);
    void runInSplash("document.body.classList.add('migrating')");
}

/**
 * Push a progress frame into the splash. Fire-and-forget: a failed update is
 * a cosmetic problem, and must never interrupt the migration driving it.
 */
export function updateSplashMigrationProgress(view: {
    percent: number;
    primary: string;
    eta: string;
    phase: string;
}): void {
    const set = (id: string, prop: 'textContent' | 'width', value: string) =>
        prop === 'width'
            ? `(function(){var e=document.getElementById('${id}'); if(e) e.style.width=${JSON.stringify(value)};})();`
            : `(function(){var e=document.getElementById('${id}'); if(e) e.textContent=${JSON.stringify(value)};})();`;

    void runInSplash([
        set('migration-fill', 'width', `${view.percent}%`),
        set('migration-primary', 'textContent', view.primary),
        set('migration-eta', 'textContent', view.eta),
        set('migration-phase', 'textContent', view.phase),
    ].join(''));
}

async function runInSplash(script: string): Promise<void> {
    if (!splashWindow || splashWindow.isDestroyed()) return;
    try {
        await splashWindow.webContents.executeJavaScript(script);
    } catch {
        // The window can close underneath us mid-migration; nothing to do.
    }
}

/**
 * Close the splash screen.
 */
export function closeSplashScreen(): void {
    if (!splashWindow || splashWindow.isDestroyed()) {
        splashWindow = null;
        return;
    }

    const win = splashWindow;
    splashWindow = null;

    // Brief delay before closing to avoid abrupt disappearance
    setTimeout(() => {
        if (!win.isDestroyed()) {
            win.close();
        }
    }, 200);
}

/**
 * Check if splash screen is currently showing.
 */
export function isSplashScreenVisible(): boolean {
    return splashWindow !== null && !splashWindow.isDestroyed();
}
