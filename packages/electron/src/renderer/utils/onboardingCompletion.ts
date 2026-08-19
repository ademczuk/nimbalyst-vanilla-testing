import type { OnboardingData } from '../components/UnifiedOnboarding/UnifiedOnboarding';
import { captureOnboardingCompletion } from './onboardingAnalytics';

export async function persistOnboardingCompletion(data: OnboardingData): Promise<void> {
  const roleToStore = data.customRole || data.role || undefined;

  await window.electronAPI.invoke('onboarding:update', {
    userRole: roleToStore,
    userEmail: data.email || undefined,
    referralSource: data.referralSource || undefined,
    unifiedOnboardingCompleted: true,
    onboardingCompleted: true,
  });

  await window.electronAPI.invoke('developer-mode:set', data.developerMode);

  // Reported here rather than at the call sites so a new completion path cannot
  // silently skip it, as the project-manager onboarding window did when it was
  // added.
  captureOnboardingCompletion(data);
}
