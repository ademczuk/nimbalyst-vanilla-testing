/**
 * Declared agent-capability contract.
 *
 * Before this existed, host-surface capabilities were optional duck-typed
 * methods on `AIProvider` (`getSlashCommands?()`, `getSkills?()`) and callers
 * asked `typeof provider.getSkills === 'function'`. That made "this provider
 * never implemented it" indistinguishable from "this provider has none right
 * now": both produced an empty list, no error, and no compile failure. A
 * transport migration could silently drop a capability and nothing in the
 * system would ever say so — which is how #1251-#1254 shipped.
 *
 * Two properties make that class of bug loud instead of silent:
 *
 * 1. `AgentCapabilities` has no optional members, and
 *    `BUILTIN_AGENT_CAPABILITIES` is an exhaustive `Record<AIProviderType, …>`.
 *    Adding a capability breaks every provider entry until it says yes or no;
 *    adding a provider to `AI_PROVIDER_TYPES` breaks the record until it
 *    declares. There is no partial-with-defaults helper on purpose — a
 *    permissive default is exactly the hole this closes.
 * 2. Support is declared separately from the data. `slashCommands: false` with
 *    an empty list means "there is no mechanism, hide the affordance";
 *    `slashCommands: true` with an empty list means "supported, nothing to
 *    show yet" (e.g. the catalog arrives with the SDK init payload).
 *
 * Context reporting is the obvious next member — a provider that never reports
 * usage currently shows a lying 0% rather than hiding the indicator — but it is
 * left out until the per-provider answers are measured rather than guessed.
 */

import type { AIProviderType } from './types';

/**
 * How the host compacts a session's context.
 *
 * - `'rpc'`: the provider implements `compactSession(sessionId)` against a real
 *   protocol call.
 * - `'slash-command'`: the agent itself interprets a `/compact` user turn.
 * - `'unsupported'`: neither. Sending `/compact` as prompt text reaches the
 *   model as literal words and silently does nothing (#1252), so the caller
 *   must hide the action rather than offer a no-op.
 */
export type CompactionSupport = 'rpc' | 'slash-command' | 'unsupported';

export interface AgentCapabilities {
  /**
   * The provider can enumerate slash commands it will genuinely service, via
   * `getSlashCommands()`. This is about provider-*native* commands only —
   * workspace `.claude/commands` files are the AgentWorkflowService's business
   * and are surfaced regardless.
   */
  slashCommands: boolean;

  /** The provider can enumerate skills it can resolve, via `getSkills()`. */
  skills: boolean;

  compaction: CompactionSupport;
}

/**
 * Fail-closed declaration: chat providers, and any agent whose support is
 * unknown (an extension contribution whose manifest says nothing).
 */
export const NO_AGENT_CAPABILITIES: AgentCapabilities = Object.freeze({
  slashCommands: false,
  skills: false,
  compaction: 'unsupported',
});

/**
 * Per-provider-type declarations for everything built in to Nimbalyst.
 *
 * Instances may narrow this further — `OpenAICodexProvider` reports
 * `compaction: 'unsupported'` when it is running the legacy SDK transport,
 * which has no compaction RPC.
 */
export const BUILTIN_AGENT_CAPABILITIES: Readonly<Record<AIProviderType, AgentCapabilities>> = Object.freeze({
  // Chat providers: no agent surfaces at all.
  claude: NO_AGENT_CAPABILITIES,
  openai: NO_AGENT_CAPABILITIES,
  lmstudio: NO_AGENT_CAPABILITIES,

  // The Claude Agent SDK reports its own commands and skills in the init
  // payload and interprets `/compact` as a real command.
  'claude-code': { slashCommands: true, skills: true, compaction: 'slash-command' },

  // The genuine CLI is driven by its PTY, not by this provider class:
  // `sendMessage` throws, so there is nothing here to enumerate or compact.
  // Its own TUI still handles `/`-commands the user types into the terminal.
  'claude-code-cli': { slashCommands: false, skills: false, compaction: 'unsupported' },

  // Codex: skills are real (skills/list over the app-server), slash commands
  // are not — the app-server interprets none, so the catalog is deliberately
  // empty rather than advertising TUI names that no-op (#1252). Compaction is
  // `thread/compact/start`.
  'openai-codex': { slashCommands: false, skills: true, compaction: 'rpc' },

  // ACP and the remaining CLI agents expose none of the three over their
  // protocols today. Declared unsupported rather than left ambiguous.
  'openai-codex-acp': { slashCommands: false, skills: false, compaction: 'unsupported' },
  opencode: { slashCommands: false, skills: false, compaction: 'unsupported' },
  'copilot-cli': { slashCommands: false, skills: false, compaction: 'unsupported' },
});

/**
 * Declaration for a provider id when no live instance is available (the `/`
 * typeahead runs before a session has started, and the compact affordance is
 * decided in the renderer). Unknown ids — extension-contributed agents, which
 * declare from their manifest via the extension bridge — fail closed.
 */
export function agentCapabilitiesForProviderType(providerType?: string | null): AgentCapabilities {
  if (!providerType) {
    return NO_AGENT_CAPABILITIES;
  }
  return (BUILTIN_AGENT_CAPABILITIES as Record<string, AgentCapabilities>)[providerType]
    ?? NO_AGENT_CAPABILITIES;
}
