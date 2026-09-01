import Store from 'electron-store';

// Debounced re-sync of the available-models list to mobile. The renderer can
// send rapid providerSettings slices when toggling providers, so coalesce them
// into a single mobile sync. Enabling an agent provider (e.g. openai-codex)
// must refresh the mobile model picker, which otherwise only happens on
// desktop startup / mobile reconnect / OpenAI-key change (NIM-976).
let mobileSettingsSyncTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleMobileSettingsSync(): void {
  if (mobileSettingsSyncTimer) clearTimeout(mobileSettingsSyncTimer);
  mobileSettingsSyncTimer = setTimeout(() => {
    mobileSettingsSyncTimer = null;
    import('../SyncManager').then(({ syncSettingsToMobile }) => {
      // Pass the stored OpenAI key so we don't drop it from the mobile payload;
      // mobile keeps its existing key when the field is absent, so either is safe.
      const apiKeys = new Store<Record<string, unknown>>({ name: 'ai-settings' }).get('apiKeys', {}) as Record<string, string>;
      syncSettingsToMobile(apiKeys['openai']);
    }).catch(() => { /* sync manager may not be available */ });
  }, 500);
}
