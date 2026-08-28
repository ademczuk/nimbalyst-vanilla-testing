/**
 * AgentProviderRegistry
 *
 * Main-process singleton that catalogs every `aiAgentProviders` contribution
 * surfaced by an installed extension. The registry is the lookup table the
 * AI session wiring uses to:
 *
 *   1. Populate the agent-provider dropdown in the renderer (status
 *      `registered` / `pending-consent` -> hidden or pre-consent placeholder;
 *      `active` -> selectable; `denied` -> hidden).
 *   2. Resolve `${extensionId}/${contributionId}` keys back to the manifest
 *      contribution + backing backend module id at session start time.
 *
 * The registry holds METADATA only. It does NOT spawn the backend module --
 * that is `PrivilegedExtensionHost.startModule`'s job and only happens lazily,
 * the first time a session targets the provider (per the Phase 4 design doc,
 * the trigger is the first-use consent prompt + workspace pick, not extension
 * load). The registry tracks the post-prompt status so the dropdown can
 * reflect what the user has actually consented to.
 *
 * Lifecycle:
 *   - On extension load / re-scan, the loader calls `register` for each
 *     aiAgentProviders entry whose backing backendModule survived validation
 *     and the allowlist.
 *   - On extension uninstall (or rescan dropping an extension), the loader
 *     calls `clearAll(extensionId)` to evict every entry for that extension.
 *   - `updateStatus` is called by the AI session wiring when consent is
 *     raised, granted, or denied.
 *
 * Status values mirror the post-consent state machine, not the underlying
 * runtime state (the latter lives on `PrivilegedExtensionHost`):
 *   - `registered`       -- in the catalog, no consent attempted yet
 *   - `pending-consent`  -- consent prompt is live (renderer can show a spinner)
 *   - `active`           -- backend module has been started at least once
 *   - `denied`           -- user declined consent; hidden from dropdown
 */

import type {
  AiAgentProviderContribution,
  ExtensionManifest,
} from '@nimbalyst/extension-sdk';
import { AI_PROVIDER_TYPES } from '@nimbalyst/runtime/ai/server/types';

const BUILTIN_PROVIDER_IDS: ReadonlySet<string> = new Set<string>(AI_PROVIDER_TYPES);

function isBuiltinProviderId(contributionId: string): boolean {
  return BUILTIN_PROVIDER_IDS.has(contributionId);
}

export type AgentProviderStatus =
  | 'registered'
  | 'pending-consent'
  | 'active'
  | 'denied';

export interface AgentProviderEntry {
  /** Extension id from the manifest (e.g., `com.example.antigravity`). */
  extensionId: string;
  /** Contribution id unique within the extension (e.g., `antigravity-gemini`). */
  contributionId: string;
  /** The full manifest the contribution came from. Useful for surfacing display strings + permissions in the consent prompt. */
  manifest: ExtensionManifest;
  /** The contribution itself. Carries display name, models, supportsResume, etc. */
  contribution: AiAgentProviderContribution;
  /**
   * Id of the BackendModuleContribution that implements the AgentProtocol
   * for this provider. Same value as `contribution.backendModuleId`; copied
   * out to a top-level field so callers don't have to dig.
   */
  backendModuleId: string;
  /** Absolute path to the extension on disk -- needed by PrivilegedExtensionHost.startModule. */
  extensionPath: string;
  status: AgentProviderStatus;
}

function makeKey(extensionId: string, contributionId: string): string {
  return `${extensionId}/${contributionId}`;
}

class AgentProviderRegistryImpl {
  private entries = new Map<string, AgentProviderEntry>();

  /**
   * Register (or replace) a provider entry. Called by the extension loader
   * for each `aiAgentProviders` contribution whose backing backendModule
   * survived validation + allowlist.
   *
   * New entries start as `registered`. If the key already exists with a
   * non-default status (e.g. `active`), the status is preserved -- a rescan
   * shouldn't tear down a running provider.
   */
  register(entry: Omit<AgentProviderEntry, 'status'> & { status?: AgentProviderStatus }): void {
    // A contribution may not claim an id the app already owns. `session.provider`
    // is a flat string, and every "is this an extension agent?" check resolves
    // it through this registry -- so a colliding contribution does not merely
    // shadow the built-in provider in the picker, it takes over the built-in's
    // sessions, auth path and file tracking.
    //
    // This is not hypothetical: `antigravity-gemini-agent` shipped as an
    // extension contribution before it became a built-in provider, and an
    // install that still carries a copy of that extension would otherwise
    // re-register the id and quietly undo the move. Built-in wins; the stale
    // contribution is dropped.
    if (isBuiltinProviderId(entry.contributionId)) {
      console.warn(
        `[AgentProviderRegistry] ${entry.extensionId} contributes "${entry.contributionId}", `
        + 'which is a built-in provider id. Ignoring the contribution; the built-in provider is used.',
      );
      return;
    }
    const key = makeKey(entry.extensionId, entry.contributionId);
    const existing = this.entries.get(key);
    const status: AgentProviderStatus = entry.status ?? existing?.status ?? 'registered';
    this.entries.set(key, { ...entry, status });
  }

  get(key: string): AgentProviderEntry | undefined;
  get(extensionId: string, contributionId: string): AgentProviderEntry | undefined;
  get(keyOrExtensionId: string, contributionId?: string): AgentProviderEntry | undefined {
    const key = contributionId === undefined
      ? keyOrExtensionId
      : makeKey(keyOrExtensionId, contributionId);
    return this.entries.get(key);
  }

  /** List every registered entry. Order is insertion order. */
  list(): AgentProviderEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Look up an entry by `contributionId` alone (no extensionId).
   *
   * This is used by the host-side provider-resolution shim
   * (`services/ai/providerResolution.ts`). Sessions today persist
   * `session.provider` as the flat `AIProviderType` string union, which
   * holds only the contribution id (`antigravity-gemini-agent`) and not
   * the `${extensionId}/${contributionId}` composite key. The shim relies
   * on this method to recover the full ref.
   *
   * Known limitation flagged for Greg's ratification in the seed PR:
   * if two extensions ship contributions with the same `contributionId`,
   * the first registered entry wins. The proper fix is widening
   * `session.provider` to a discriminated union with an explicit
   * `(extensionId, contributionId)` ref, which is a schema change that
   * sits behind this shim.
   *
   * Returns first-match insertion-order entry or `undefined`.
   */
  findByContributionId(contributionId: string): AgentProviderEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.contributionId === contributionId) return entry;
    }
    return undefined;
  }

  /**
   * Update the status of one entry. No-op if the key is unknown -- the
   * caller is allowed to be defensive without first checking presence.
   */
  updateStatus(extensionId: string, contributionId: string, status: AgentProviderStatus): void {
    const key = makeKey(extensionId, contributionId);
    const existing = this.entries.get(key);
    if (!existing) return;
    this.entries.set(key, { ...existing, status });
  }

  /** Remove every entry contributed by `extensionId`. Called on uninstall. */
  clearAll(extensionId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.extensionId === extensionId) this.entries.delete(key);
    }
  }

  /** Test-only: wipe everything. */
  __resetForTests(): void {
    this.entries.clear();
  }
}

let singleton: AgentProviderRegistryImpl | null = null;

/** Lazy singleton accessor. Same lifetime contract as PrivilegedExtensionHost. */
export function getAgentProviderRegistry(): AgentProviderRegistryImpl {
  if (!singleton) singleton = new AgentProviderRegistryImpl();
  return singleton;
}

export { makeKey as agentProviderKey };
export type AgentProviderRegistry = AgentProviderRegistryImpl;
