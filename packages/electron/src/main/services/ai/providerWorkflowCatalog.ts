/**
 * Resolves the provider-native workflow catalog (slash commands + skills) that
 * feeds the `/` typeahead, and the declared capabilities that say what the
 * catalog *means*.
 *
 * This replaces a per-provider fallback ladder that asked
 * `typeof provider.getSlashCommands === 'function'`, then, if the answer came
 * back empty, tried the next branch down. That shape had two failure modes and
 * both shipped: an empty catalog from a provider that genuinely has none fell
 * through to somebody else's list, and a provider that never implemented the
 * method was indistinguishable from one whose list happened to be empty
 * (#1251-#1254). Capability is now asked once, up front, and the answer decides
 * whether the catalog is read at all.
 */

import type { AIProvider } from '@nimbalyst/runtime/ai/server/AIProvider';
import { readProviderWorkflowCatalog } from '@nimbalyst/runtime/ai/server/AIProvider';
import {
  agentCapabilitiesForProviderType,
  type AgentCapabilities,
} from '@nimbalyst/runtime/ai/server/agentCapabilities';

export interface ProviderWorkflowCatalog {
  commands: string[];
  skills: string[];
  capabilities: AgentCapabilities;
}

export interface ProviderWorkflowCatalogDeps {
  /** Live provider instance for this session, if one has been created. */
  instance?: AIProvider | null;
  /**
   * Cross-session cache for a provider whose catalog is only learned from a
   * live session (claude-code learns its commands from the SDK init payload).
   * Consulted only when there is no live instance AND the capability is
   * declared, so it can never resurrect the old cross-provider fallthrough.
   */
  cachedCatalog?: () => { commands: string[]; skills: string[] };
}

export function resolveProviderWorkflowCatalog(
  providerType: string | null | undefined,
  deps: ProviderWorkflowCatalogDeps = {},
): ProviderWorkflowCatalog {
  const instance = deps.instance ?? null;
  // A live instance is authoritative: it can narrow the type-level declaration
  // to the transport actually running (Codex app-server vs legacy SDK).
  const capabilities = instance
    ? instance.getAgentCapabilities()
    : agentCapabilitiesForProviderType(providerType);

  if (!capabilities.slashCommands && !capabilities.skills) {
    return { commands: [], skills: [], capabilities };
  }

  const catalog = instance
    ? readProviderWorkflowCatalog(instance)
    : deps.cachedCatalog?.() ?? { commands: [], skills: [] };

  return {
    commands: capabilities.slashCommands ? catalog.commands : [],
    skills: capabilities.skills ? catalog.skills : [],
    capabilities,
  };
}
