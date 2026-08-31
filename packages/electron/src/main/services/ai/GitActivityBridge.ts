import { logger } from '../../utils/logger';
import { containsDirectGitCommand } from '../gitCommandClassifier';
import type { GitOperationLogService } from '../GitOperationLogService';

/** What a provider's tool result tells us about how the command ended. */
export interface ToolResultOutcome {
  /** Whether the result proves the tool call is over. */
  terminal: boolean;
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
}

/** Journal output is capped anyway; do not hand it a whole build log to trim. */
const MAX_RESULT_OUTPUT_CHARS = 64 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Read a provider tool result. Providers disagree on shape -- some hand back a
 * bare string, some `{ stdout, exitCode }`, some `{ success: false, error }` --
 * so this normalizes rather than trusting any one of them.
 */
export function interpretToolResult(result: unknown): ToolResultOutcome {
  if (result === undefined || result === null) return { terminal: false, success: false };

  if (typeof result === 'string') {
    return { terminal: true, success: true, output: result.slice(0, MAX_RESULT_OUTPUT_CHARS) };
  }

  const record = asRecord(result);
  if (!record) {
    return { terminal: true, success: true, output: String(result).slice(0, MAX_RESULT_OUTPUT_CHARS) };
  }

  const exitCode = typeof record.exitCode === 'number'
    ? record.exitCode
    : typeof record.exit_code === 'number'
      ? record.exit_code
      : undefined;
  const error = firstString(record, ['error', 'errorMessage', 'stderr']);
  const output = firstString(record, ['output', 'stdout', 'content', 'result']);

  const success = exitCode !== undefined
    ? exitCode === 0
    : record.success === false || record.is_error === true
      ? false
      : !firstString(record, ['error', 'errorMessage']);

  return {
    terminal: true,
    success,
    output: output?.slice(0, MAX_RESULT_OUTPUT_CHARS),
    error: success ? undefined : error?.slice(0, MAX_RESULT_OUTPUT_CHARS),
    exitCode,
  };
}

/** A shell tool call, reduced to what the journal needs, or null if it holds nothing to observe. */
export interface BashCommandObservation {
  command: string;
  providerToolCallId: string;
  result: unknown;
}

/**
 * Read a provider's shell tool call into a journal observation.
 *
 * Both stream events for one command go through here so they address the same
 * entry. That matters most for Claude Code, which yields `tool_call` once (at
 * `tool_use`, with no result) and then attaches the result by mutating that
 * same object -- so the terminal read is of an object we have already seen.
 *
 * Prefers the synthetic tool-use id, and on Codex accepts nothing else: Codex
 * reuses raw ids like `item_0` across turns, which would merge unrelated
 * commands into one entry.
 */
export function bashCommandObservation(
  toolCall: unknown,
  provider?: string,
): BashCommandObservation | null {
  const record = asRecord(toolCall);
  if (!record || record.name !== 'Bash') return null;

  const args = asRecord(record.arguments);
  const command = typeof args?.command === 'string' ? args.command : undefined;
  if (!command) return null;

  const rawId = provider === 'openai-codex' ? undefined : record.id;
  const providerToolCallId = typeof record.toolUseId === 'string'
    ? record.toolUseId
    : typeof rawId === 'string'
      ? rawId
      : undefined;
  if (!providerToolCallId) return null;

  return { command, providerToolCallId, result: record.result };
}

interface ObservedCommand {
  workspacePath: string;
  finished: boolean;
}

/**
 * Mirror an agent turn's direct Git commands into the workspace Git journal, so
 * the menu-bar indicator and the Git panel's Output tab show them alongside
 * Nimbalyst's own operations.
 *
 * Strictly observational. It never spawns, cancels, or serializes anything --
 * the provider owns those processes, and pretending otherwise (by taking the
 * Git lock, say) would stall the user's own Git actions behind an agent's.
 *
 * One instance per streaming turn; call `interruptOutstanding` when the turn
 * ends so a command whose completion never arrived does not read as running
 * until the next app restart.
 */
export class GitActivityBridge {
  private readonly observed = new Map<string, ObservedCommand>();

  constructor(
    private readonly operationLog: GitOperationLogService,
    private readonly sessionId: string,
    private readonly provider?: string,
  ) {}

  /**
   * Record one observation of a shell tool call. Safe to call repeatedly for the
   * same `providerToolCallId`: providers re-emit starts, and Codex sends both
   * `item.started` and `item.completed` for a single `command_execution`.
   *
   * `providerToolCallId` must be the stable synthetic id, not a raw provider id
   * -- Codex reuses ids like `item_0` across turns, which would merge unrelated
   * commands into one entry.
   */
  async observe(input: {
    command: string;
    workspacePath: string;
    providerToolCallId: string;
    result: unknown;
  }): Promise<void> {
    if (!input.providerToolCallId || !input.workspacePath) return;
    if (!containsDirectGitCommand(input.command)) return;

    const existing = this.observed.get(input.providerToolCallId);
    if (existing?.finished) return;

    if (!existing) {
      this.observed.set(input.providerToolCallId, {
        workspacePath: input.workspacePath,
        finished: false,
      });
      await this.operationLog.startExternal({
        workspacePath: input.workspacePath,
        command: input.command,
        source: 'agent',
        sessionId: this.sessionId,
        provider: this.provider,
        providerToolCallId: input.providerToolCallId,
      });
    }

    const outcome = interpretToolResult(input.result);
    if (!outcome.terminal) return;

    const entry = this.observed.get(input.providerToolCallId)!;
    entry.finished = true;
    await this.operationLog.finishExternal({
      workspacePath: entry.workspacePath,
      sessionId: this.sessionId,
      providerToolCallId: input.providerToolCallId,
      success: outcome.success,
      output: outcome.output,
      error: outcome.error,
      exitCode: outcome.exitCode,
    });
  }

  /**
   * Terminalize anything still running. Called when the turn ends -- normally,
   * on cancellation, or on a provider failure -- because a result that never
   * arrives would otherwise leave the indicator spinning indefinitely.
   */
  async interruptOutstanding(reason?: string): Promise<void> {
    for (const [providerToolCallId, entry] of this.observed) {
      if (entry.finished) continue;
      entry.finished = true;
      try {
        await this.operationLog.interruptExternal({
          workspacePath: entry.workspacePath,
          sessionId: this.sessionId,
          providerToolCallId,
          reason,
        });
      } catch (error) {
        logger.main.error('[GitActivityBridge] Failed to interrupt observed command:', error);
      }
    }
  }
}
