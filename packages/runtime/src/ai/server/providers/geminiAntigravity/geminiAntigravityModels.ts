/**
 * Model catalog for the `antigravity-gemini-agent` provider.
 *
 * The language server DOES enumerate models -- `GetAvailableModels` returns the
 * full catalog and `GetUserStatus.cascadeModelConfigData.clientModelConfigs`
 * returns the subset the signed-in account may actually use. When the extension
 * owned this provider its manifest hardcoded three model ids, and by the time
 * this moved in-tree that list was already stale: the live catalog carried a
 * Gemini 3.6 Flash family the picker never offered. That drift is exactly
 * NIM-1486, so discovery is the primary source and the seed list below is only
 * a fallback.
 *
 * Discovery never spawns the server. Enumerating models is a passive act (the
 * user opened a picker), and starting a ~120MB language server for it would be
 * a surprising side effect -- so when no endpoint is live the seed list is
 * returned and discovery fills in after the first real turn. Same posture as
 * `GrokBuildProvider.listModelIds()`, which falls back to its default when the
 * CLI cannot be reached.
 *
 * The catalog spans several vendors (Antigravity also fronts Anthropic and
 * OpenAI models). This is the *Gemini* provider, so only Google-served entries
 * are offered; surfacing the others here would put the same model behind two
 * unrelated Nimbalyst providers with different billing stories.
 */

import type { AntigravityModelInfo, AntigravityServerManager } from './AntigravityServerManager';

/** `apiProvider` value the language server reports for Google-served models. */
const GOOGLE_API_PROVIDER = 'API_PROVIDER_GOOGLE_GEMINI';

/**
 * Fallback catalog, used only until the language server has been reached once.
 *
 * These are the ids that existing Gemini session rows persist, so they must
 * keep their exact keys -- a session created against
 * `antigravity-gemini-agent:gemini-3-flash-agent` has to keep resolving. The
 * display names are the server's own labels, which do not match the keys
 * (`gemini-3-flash-agent` is labelled "Gemini 3.5 Flash (High)").
 */
export const SEED_GEMINI_MODELS: ReadonlyArray<{ key: string; displayName: string }> =
  Object.freeze([
    { key: 'gemini-3-flash-agent', displayName: 'Gemini 3.5 Flash (High)' },
    { key: 'gemini-3.5-flash-low', displayName: 'Gemini 3.5 Flash (Medium)' },
    { key: 'gemini-3.5-flash-extra-low', displayName: 'Gemini 3.5 Flash (Low)' },
  ]);

/** Default model key for a new Gemini session. */
export const DEFAULT_GEMINI_MODEL_KEY = 'gemini-3-flash-agent';

/**
 * Strip the `antigravity-gemini-agent:` namespace off a stored model id.
 *
 * The host persists the namespaced form; the language server only knows the
 * bare key. Callers may hand us either.
 */
export function bareGeminiModelKey(raw: string | undefined | null): string {
  if (!raw) return DEFAULT_GEMINI_MODEL_KEY;
  return raw.includes(':') ? raw.split(':').slice(1).join(':') : raw;
}

/**
 * Google-served models the signed-in account may use, newest-looking first.
 *
 * `entitledEnums` is the set of model enums from `clientModelConfigs`. It is
 * the account's entitlement, not the build's catalog: a model present in
 * `GetAvailableModels` but absent here will fail at request time, so offering
 * it would only produce a confusing error after the user picked it. When the
 * entitlement set is empty (an older server that does not report it) the
 * catalog is used unfiltered rather than showing nothing.
 */
export function selectGeminiModels(
  catalog: Map<string, AntigravityModelInfo>,
  entitledEnums: ReadonlySet<string>,
): Array<{ key: string; displayName: string }> {
  const out: Array<{ key: string; displayName: string }> = [];
  for (const info of catalog.values()) {
    if (info.apiProvider !== GOOGLE_API_PROVIDER) continue;
    if (entitledEnums.size > 0 && !entitledEnums.has(info.enum)) continue;
    // An unlabelled entry is an internal/experimental slot (the server returns
    // several with no displayName). Nothing useful to show the user.
    if (!info.displayName) continue;
    out.push({ key: info.key, displayName: info.displayName });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Read the account's entitled model enums out of a raw GetUserStatus payload. */
export function entitledModelEnums(userStatus: unknown): Set<string> {
  const enums = new Set<string>();
  const configs = (userStatus as {
    cascadeModelConfigData?: { clientModelConfigs?: Array<{ modelOrAlias?: { model?: unknown } }> };
  } | null | undefined)?.cascadeModelConfigData?.clientModelConfigs;
  if (!Array.isArray(configs)) return enums;
  for (const config of configs) {
    const name = config?.modelOrAlias?.model;
    if (typeof name === 'string' && name) enums.add(name);
  }
  return enums;
}

/**
 * Discover the model list, falling back to the seed when the server is not
 * already running or either RPC fails.
 */
export async function discoverGeminiModels(
  server: AntigravityServerManager,
): Promise<Array<{ key: string; displayName: string }>> {
  const endpoint = server.currentEndpoint();
  if (!endpoint) return [...SEED_GEMINI_MODELS];
  try {
    const [catalog, userStatus] = await Promise.all([
      server.getAvailableModels(endpoint),
      server.getUserStatus(endpoint).catch(() => null),
    ]);
    const models = selectGeminiModels(catalog, entitledModelEnums(userStatus));
    return models.length > 0 ? models : [...SEED_GEMINI_MODELS];
  } catch {
    return [...SEED_GEMINI_MODELS];
  }
}
