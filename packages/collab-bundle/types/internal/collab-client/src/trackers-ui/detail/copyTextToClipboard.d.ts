/**
 * Copy text through the host-aware runtime seam.
 *
 * Electron's web clipboard can resolve successfully without actually writing,
 * so desktop callers must not use `navigator.clipboard` directly. Keep the
 * runtime helper behind this dynamic import: tracker surfaces are a cold entry,
 * and clipboard support should load only when a copy action runs.
 */
export declare function copyTextToClipboard(text: string): Promise<void>;
