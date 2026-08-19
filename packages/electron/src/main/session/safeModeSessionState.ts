let protectSavedSessionState = false;

export function setSafeModeSessionStateProtection(enabled: boolean): void {
  protectSavedSessionState = enabled;
}

/**
 * Keep the pre-safe-mode restore record while only Workspace Manager exists.
 * Opening a real workspace is an explicit recovery action and releases the
 * protection so normal session persistence resumes.
 */
export function shouldSuppressSafeModeSessionSave(
  windows: Array<{ mode?: string; workspacePath?: string }>,
): boolean {
  if (!protectSavedSessionState) return false;
  if (windows.some((window) => window.mode === 'workspace' && !!window.workspacePath)) {
    protectSavedSessionState = false;
    return false;
  }
  return true;
}
