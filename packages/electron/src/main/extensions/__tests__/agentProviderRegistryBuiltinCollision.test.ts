// @vitest-environment node
/**
 * A contribution may not claim a built-in provider id.
 *
 * This is not a hypothetical clash. `antigravity-gemini-agent` shipped as an
 * `aiAgentProviders` contribution before it became a built-in provider, so an
 * install that still carries a copy of that extension — a marketplace install,
 * or a stale bundle — will offer the id again on the next launch.
 *
 * The damage a collision does is worse than a duplicate row in the picker.
 * `session.provider` is a flat string, and every "is this an extension agent?"
 * check resolves it through this registry, so a colliding entry silently takes
 * over the built-in provider's session routing, auth path and file tracking.
 * The failure would look like Gemini simply not tracking files again.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';

import { getAgentProviderRegistry } from '../AgentProviderRegistry';
import type { ExtensionManifest, AiAgentProviderContribution } from '@nimbalyst/extension-sdk';

function entry(contributionId: string) {
  return {
    extensionId: 'gemini-antigravity',
    contributionId,
    manifest: { id: 'gemini-antigravity' } as unknown as ExtensionManifest,
    contribution: { id: contributionId } as unknown as AiAgentProviderContribution,
    backendModuleId: 'antigravity-server',
    extensionPath: '/fixture/extensions/gemini-antigravity',
  };
}

describe('AgentProviderRegistry built-in id collision', () => {
  beforeEach(() => {
    getAgentProviderRegistry().clearAll('gemini-antigravity');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    getAgentProviderRegistry().clearAll('gemini-antigravity');
    vi.restoreAllMocks();
  });

  it('refuses a contribution that claims a built-in provider id', () => {
    getAgentProviderRegistry().register(entry('antigravity-gemini-agent'));

    // Nothing registered, so `isExtensionAgentProvider('antigravity-gemini-agent')`
    // stays false and the built-in provider keeps the id.
    expect(getAgentProviderRegistry().findByContributionId('antigravity-gemini-agent'))
      .toBeUndefined();
  });

  it('still registers a contribution id the app does not own', () => {
    getAgentProviderRegistry().register(entry('some-third-party-agent'));
    expect(getAgentProviderRegistry().findByContributionId('some-third-party-agent'))
      .toMatchObject({ contributionId: 'some-third-party-agent', status: 'registered' });
  });
});
