/**
 * Grok Build ACP protocol adapter.
 *
 * Runs the authenticated Grok CLI as `grok agent stdio` and speaks ACP v1 via
 * the official client SDK. Grok's ACP updates retain the same raw input,
 * output, and diff blocks as its legacy `-p --output-format streaming-json`
 * surface, while keeping stdin open for permission and extension round-trips.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { Readable, Writable } from 'stream';
import {
  ClientSideConnection,
  RequestError,
  ndJsonStream,
} from '@agentclientprotocol/sdk';
import type {
  CancelNotification,
  McpServer,
  PermissionOption,
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionModelState,
  SessionNotification,
  ToolCallUpdate,
  Usage,
} from '@agentclientprotocol/sdk';
import {
  mapGrokAcpSessionUpdate,
  readGrokACPUpdateEnvelope,
} from './headless/GrokBuildRecordMapper';
export {
  mapGrokAcpSessionUpdate,
  readGrokACPUpdateEnvelope,
} from './headless/GrokBuildRecordMapper';
import { scrubProviderApiKeys } from '../providerApiKeyScrub';
import type {
  AgentProtocol,
  MCPServerConfig,
  ProtocolEvent,
  ProtocolMessage,
  ProtocolSession,
  SessionOptions,
} from './ProtocolInterface';
import type { ToolPermissionScope } from '../providers/ProviderPermissionMixin';

const PLATFORM = 'grok-build-acp';
const DEFAULT_ARGS = ['agent', 'stdio'];
const STDERR_TAIL_LIMIT = 64 * 1024;

type ACPClientConnection = InstanceType<typeof ClientSideConnection>;

export interface GrokACPPermissionDecision {
  decision: 'allow' | 'deny';
  scope: ToolPermissionScope;
}

export interface GrokACPPermissionRequest {
  requestId: string;
  /** Provider-side ACP session id. */
  sessionId: string;
  /** Host session id used by Nimbalyst's permission persistence/UI. */
  nimbalystSessionId?: string;
  workspacePath: string;
  permissionsPath?: string;
  toolName: string;
  providerToolName: string;
  toolTitle: string;
  toolKind?: string | null;
  toolInput?: unknown;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  signal: AbortSignal;
}

export interface GrokAskUserQuestionRequest extends Record<string, unknown> {
  /** Provider-side ACP session id, as sent by Grok. */
  sessionId: string;
  toolCallId: string;
  questions: Array<{
    question: string;
    options?: Array<{ label: string; description?: string }> | null;
    multiSelect?: boolean | null;
  }>;
  mode?: string;
  /**
   * Host session id the question belongs to. The handler is an application-wide
   * static while questions arrive per session, so this — not "the active
   * session" — is what routes the prompt to the transcript that asked.
   * Absent when no turn is active for the ACP session (nothing to answer into).
   */
  nimbalystSessionId?: string;
  workspacePath?: string;
  /** Aborts when the turn is cancelled, so a pending question can settle. */
  signal?: AbortSignal;
}

export interface GrokAskUserQuestionResponse extends Record<string, unknown> {
  outcome: 'accepted' | 'cancelled';
  answers: Record<string, string | string[]>;
  partial_answers: boolean;
}

/**
 * Slice B's extension seam: install a handler that presents Grok's native
 * questions and resolves with the captured xAI response schema.
 */
export type GrokAskUserQuestionHandler = (
  request: GrokAskUserQuestionRequest,
) => Promise<GrokAskUserQuestionResponse>;

export interface GrokACPProtocolDeps {
  spawnProcess?: typeof spawn;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  onPermissionRequest?: (
    request: GrokACPPermissionRequest,
  ) => Promise<GrokACPPermissionDecision>;
  onAskUserQuestion?: GrokAskUserQuestionHandler;
}

interface GrokSessionRaw extends Record<string, unknown> {
  workspacePath: string;
  options: SessionOptions;
  initializeMeta?: Record<string, unknown> | null;
}

/**
 * What was actually handed to Grok for one ACP session id.
 *
 * MCP servers and the model are delivered exactly once — at `session/new` or
 * `session/load` — and a long-lived Grok process keeps whatever it was given.
 * A later turn that re-resolves a different server set does not change what the
 * agent holds, so the delivered numbers reported to the host must come from
 * here rather than from the freshly resolved options.
 */
interface GrokSessionState {
  deliveredMcpServerCount: number;
  models: SessionModelState | null;
}

interface ActiveTurnState {
  sessionId: string;
  nimbalystSessionId?: string;
  workspacePath: string;
  permissionsPath?: string;
  signal: AbortSignal;
  queue: AsyncEventQueue<ProtocolEvent>;
}

class AsyncEventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private done = false;

  push(item: T): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as T, done: true });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.items.length > 0) {
      return { value: this.items.shift() as T, done: false };
    }
    if (this.done) {
      return { value: undefined as T, done: true };
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export class GrokACPProtocol implements AgentProtocol {
  readonly platform = PLATFORM;

  private readonly spawnProcess: typeof spawn;
  private readonly commandWasInjected: boolean;
  private command: string;
  private readonly args: string[];
  private extraEnv: Record<string, string>;
  private readonly onPermissionRequest?: GrokACPProtocolDeps['onPermissionRequest'];
  private onAskUserQuestion?: GrokAskUserQuestionHandler;

  private childProcess: ChildProcessWithoutNullStreams | null = null;
  private connection: ACPClientConnection | null = null;
  private initializationPromise: Promise<void> | null = null;
  private initializeMeta: Record<string, unknown> | null = null;
  private processExitError: Error | null = null;
  private destroying = false;
  private readonly sessionStates = new Map<string, GrokSessionState>();
  private readonly activeTurns = new Map<string, ActiveTurnState>();

  constructor(deps?: GrokACPProtocolDeps) {
    this.spawnProcess = deps?.spawnProcess ?? spawn;
    this.commandWasInjected = deps?.command !== undefined;
    this.command = deps?.command ?? 'grok';
    this.args = deps?.args ?? DEFAULT_ARGS;
    this.extraEnv = deps?.env ?? {};
    this.onPermissionRequest = deps?.onPermissionRequest;
    this.onAskUserQuestion = deps?.onAskUserQuestion;
  }

  setGrokPath(executablePath: string): void {
    if (!this.commandWasInjected) this.command = executablePath;
  }

  setProcessEnv(env: Record<string, string> | null): void {
    this.extraEnv = env ?? {};
  }

  setAskUserQuestionHandler(handler: GrokAskUserQuestionHandler | null): void {
    this.onAskUserQuestion = handler ?? undefined;
  }

  async createSession(options: SessionOptions): Promise<ProtocolSession> {
    const connection = await this.getConnection();
    const mcpServers = convertGrokMcpServers(options.mcpServers);
    const cwd = await resolveGrokCwd(options.workspacePath);
    let result;
    try {
      result = await connection.newSession({
        cwd,
        mcpServers,
      });
    } catch (error) {
      throw new Error(`Failed to create Grok ACP session: ${this.formatError(error)}`);
    }

    const state: GrokSessionState = {
      deliveredMcpServerCount: mcpServers.length,
      models: result.models ?? null,
    };
    this.sessionStates.set(result.sessionId, state);
    const appliedModel = await this.applySessionModel(result.sessionId, options.model, state);
    return this.buildSession(result.sessionId, options, cwd, state, appliedModel);
  }

  async resumeSession(sessionId: string, options: SessionOptions): Promise<ProtocolSession> {
    const connection = await this.getConnection();
    const cwd = await resolveGrokCwd(options.workspacePath);

    let state = this.sessionStates.get(sessionId);
    if (!state) {
      const mcpServers = convertGrokMcpServers(options.mcpServers);
      let result;
      try {
        result = await connection.loadSession({
          sessionId,
          cwd,
          mcpServers,
        });
      } catch (error) {
        // Never mint a replacement here. The caller persisted this provider id,
        // and silently replacing it would orphan the existing Grok history.
        throw new Error(
          `Failed to load persisted Grok session "${sessionId}": ${this.formatError(error)}`,
        );
      }
      state = {
        deliveredMcpServerCount: mcpServers.length,
        models: result?.models ?? null,
      };
      this.sessionStates.set(sessionId, state);
    }
    // No redelivery path exists: ACP hands MCP servers to session/new and
    // session/load only, and Grok keeps the set it was given for the life of
    // the process. So a later turn reports the count that was actually
    // delivered, not the count it just re-resolved — claiming delivery of a
    // server the agent has never heard of is the lie this reports around.

    const appliedModel = await this.applySessionModel(sessionId, options.model, state);
    return this.buildSession(sessionId, options, cwd, state, appliedModel);
  }

  /**
   * Put the user's selected model onto the ACP session.
   *
   * `grok agent stdio` accepts `-m` as a process-level default but resets to
   * its configured model at `session/new`, so the spawn flag alone silently
   * loses the choice. `session/set_model` is the only thing that sticks
   * (verified against grok 1.0.5, which answers `{_meta:{model:{Ok:"<id>"}}}`).
   *
   * Returns the model Grok is actually on, so the host reports what ran rather
   * than what was asked for.
   */
  private async applySessionModel(
    sessionId: string,
    requestedModel: string | undefined,
    state: GrokSessionState,
  ): Promise<string | undefined> {
    const current = state.models?.currentModelId ?? undefined;
    const wanted = requestedModel ? bareGrokModelId(requestedModel) : undefined;
    if (!wanted || wanted === current) return current;

    // An unknown id is a JSON-RPC error (-32602 "unknown model id") that would
    // otherwise abort the turn, so only ask for a model Grok has offered.
    const available = state.models?.availableModels ?? [];
    if (!available.some((model) => model.modelId === wanted)) return current;

    try {
      await this.connection?.unstable_setSessionModel({ sessionId, modelId: wanted });
    } catch {
      // Losing the model choice must not lose the turn; report what is live.
      return current;
    }
    if (state.models) state.models.currentModelId = wanted;
    return wanted;
  }

  async forkSession(_sessionId: string, options: SessionOptions): Promise<ProtocolSession> {
    return this.createSession(options);
  }

  async *sendMessage(
    session: ProtocolSession,
    message: ProtocolMessage,
  ): AsyncIterable<ProtocolEvent> {
    const connection = await this.getConnection();
    const raw = session.raw as GrokSessionRaw | undefined;
    const workspacePath = raw?.workspacePath;
    if (!workspacePath) {
      yield { type: 'error', error: 'Grok ACP session is missing its workspace path.' };
      return;
    }

    const queue = new AsyncEventQueue<ProtocolEvent>();
    const signal = message.abortSignal ?? new AbortController().signal;
    const turn: ActiveTurnState = {
      sessionId: session.id,
      nimbalystSessionId: message.sessionId,
      workspacePath,
      permissionsPath: typeof raw.options.raw?.permissionsPath === 'string'
        ? raw.options.raw.permissionsPath
        : undefined,
      signal,
      queue,
    };
    this.activeTurns.set(session.id, turn);

    const abortHandler = () => void this.cancelPrompt(session.id);
    signal.addEventListener('abort', abortHandler, { once: true });

    const promptTask = (async () => {
      try {
        const response = await connection.prompt({
          sessionId: session.id,
          prompt: this.buildPromptBlocks(message, raw.options.systemPrompt),
        });

        queue.push({
          type: 'raw_event',
          metadata: {
            rawEvent: {
              type: 'session/prompt_result',
              sessionId: session.id,
              response,
            },
          },
        });

        const usage = normalizeGrokAcpUsage(response);
        queue.push({
          type: 'complete',
          content: '',
          ...(usage ? { usage } : {}),
          metadata: {
            stopReason: response.stopReason,
            ...(response._meta ? { grokMeta: response._meta } : {}),
          },
        });
      } catch (error) {
        if (!signal.aborted) {
          queue.push({ type: 'error', error: this.formatError(error) });
        }
      } finally {
        signal.removeEventListener('abort', abortHandler);
        this.activeTurns.delete(session.id);
        queue.finish();
      }
    })();

    try {
      while (true) {
        const next = await queue.next();
        if (next.done) break;
        yield next.value;
      }
    } finally {
      await promptTask;
    }
  }

  abortSession(session: ProtocolSession): void {
    void this.cancelPrompt(session.id);
  }

  cleanupSession(session: ProtocolSession): void {
    this.activeTurns.delete(session.id);
    this.sessionStates.delete(session.id);
  }

  destroy(): void {
    this.destroying = true;
    for (const turn of this.activeTurns.values()) turn.queue.finish();
    this.activeTurns.clear();
    this.sessionStates.clear();
    this.childProcess?.kill();
    this.childProcess = null;
    this.connection = null;
    this.initializationPromise = null;
    this.destroying = false;
  }

  private buildSession(
    sessionId: string,
    options: SessionOptions,
    workspacePath: string,
    state: GrokSessionState,
    appliedModel: string | undefined,
  ): ProtocolSession {
    return {
      id: sessionId,
      platform: PLATFORM,
      deliveredMcpServerCount: state.deliveredMcpServerCount,
      ...(appliedModel ? { appliedModel } : {}),
      raw: {
        workspacePath,
        options,
        initializeMeta: this.initializeMeta,
      } satisfies GrokSessionRaw,
    };
  }

  private async getConnection(): Promise<ACPClientConnection> {
    if (this.connection) return this.connection;
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeConnection();
    }
    await this.initializationPromise;
    if (!this.connection) {
      throw new Error('Failed to initialize Grok ACP connection');
    }
    return this.connection;
  }

  private async initializeConnection(): Promise<void> {
    this.processExitError = null;
    // Scrub AFTER the merge, never before. `extraEnv` is already sanitized by
    // `HeadlessCliAgentProvider.buildChildEnvironment()`, but a deleted key is
    // an absent key, and absence does not mask the `process.env` spread it is
    // layered over — every scrubbed key came straight back. An unrelated
    // `XAI_API_KEY` in the user's shell would then authenticate and bill
    // `grok agent stdio`. See CLAUDE.md's "never use environment variables as
    // implicit API key sources".
    const child = this.spawnProcess(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: scrubProviderApiKeys({ ...process.env, ...this.extraEnv }),
      cwd: process.cwd(),
    });
    this.childProcess = child;

    let stderrTail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-STDERR_TAIL_LIMIT);
    });
    child.once('error', (error) => {
      this.processExitError = error;
    });
    child.once('exit', (code, signal) => {
      const exitReason = code !== null
        ? `Grok ACP process exited with code ${code}`
        : `Grok ACP process exited with signal ${signal ?? 'unknown'}`;
      this.processExitError = new Error(
        stderrTail.trim() ? `${exitReason}\nstderr: ${stderrTail.trim()}` : exitReason,
      );
      this.childProcess = null;
      this.connection = null;
      this.initializationPromise = null;
      // The agent held every session in memory. A replacement process knows
      // none of them, so the next turn must load and re-deliver rather than
      // trusting this process's delivery record.
      this.sessionStates.clear();
      if (!this.destroying) {
        for (const turn of this.activeTurns.values()) {
          turn.queue.push({ type: 'error', error: this.processExitError.message });
          turn.queue.finish();
        }
        this.activeTurns.clear();
      }
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = new ClientSideConnection(
      () => ({
        requestPermission: (params: RequestPermissionRequest) =>
          this.handlePermissionRequest(params),
        sessionUpdate: (params: SessionNotification) => {
          this.handleSessionUpdate(params);
          return Promise.resolve();
        },
        extMethod: (method: string, params: Record<string, unknown>) =>
          this.handleExtensionMethod(method, params),
        extNotification: (method: string, params: Record<string, unknown>) => {
          this.handleExtensionNotification(method, params);
          return Promise.resolve();
        },
      }),
      stream,
    );
    this.connection = connection;

    try {
      const response = await connection.initialize({
        protocolVersion: 1,
        clientInfo: { name: 'nimbalyst', version: '1.0.0' },
        clientCapabilities: {},
      });
      this.initializeMeta = response._meta ?? null;
    } catch (error) {
      const detail = this.formatError(this.processExitError ?? error);
      this.destroy();
      throw new Error(`Failed to initialize Grok ACP agent "${this.command}": ${detail}`);
    }
  }

  private handleSessionUpdate(params: SessionNotification): void {
    const turn = this.activeTurns.get(params.sessionId);
    if (!turn) return;

    const rawEvent = {
      jsonrpc: '2.0',
      method: 'session/update',
      params,
    };
    turn.queue.push({
      type: 'raw_event',
      metadata: { rawEvent },
    });

    const update = readGrokACPUpdateEnvelope(rawEvent);
    if (!update) return;
    for (const event of mapGrokAcpSessionUpdate(
      update,
      turn.workspacePath,
      path.resolve,
    )) {
      turn.queue.push(event);
    }
  }

  private async handlePermissionRequest(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const turn = this.activeTurns.get(params.sessionId);
    const providerToolName = deriveGrokProviderToolName(params.toolCall);
    const toolName = deriveHostToolName(providerToolName, params.toolCall.kind);

    turn?.queue.push({
      type: 'raw_event',
      metadata: {
        rawEvent: {
          type: 'session/request_permission',
          sessionId: params.sessionId,
          request: params,
        },
      },
    });
    turn?.queue.push({
      type: 'tool_call',
      toolCall: {
        id: params.toolCall.toolCallId,
        name: toolName,
        arguments: normalizeArguments(params.toolCall.rawInput),
      },
      metadata: {
        rawEvent: {
          type: 'session/request_permission_preview',
          sessionId: params.sessionId,
          toolCall: params.toolCall,
        },
      },
    });

    if (!turn || !this.onPermissionRequest) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const decision = await this.onPermissionRequest({
      requestId: params.toolCall.toolCallId,
      sessionId: params.sessionId,
      nimbalystSessionId: turn.nimbalystSessionId,
      workspacePath: turn.workspacePath,
      permissionsPath: turn.permissionsPath,
      toolName,
      providerToolName,
      toolTitle: params.toolCall.title ?? toolName,
      toolKind: params.toolCall.kind,
      toolInput: params.toolCall.rawInput,
      toolCall: params.toolCall,
      options: params.options,
      signal: turn.signal,
    });
    const selected = selectPermissionOption(params.options, decision);
    return selected
      ? { outcome: { outcome: 'selected', optionId: selected.optionId } }
      : { outcome: { outcome: 'cancelled' } };
  }

  private async handleExtensionMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method !== '_x.ai/ask_user_question') {
      throw RequestError.methodNotFound(method);
    }

    const request = params as GrokAskUserQuestionRequest;
    const turn = this.activeTurns.get(request.sessionId);
    turn?.queue.push({
      type: 'raw_event',
      metadata: {
        rawEvent: {
          type: '_x.ai/ask_user_question',
          sessionId: request.sessionId,
          request,
        },
      },
    });

    if (!this.onAskUserQuestion) {
      return {
        outcome: 'cancelled',
        answers: {},
        partial_answers: false,
      } satisfies GrokAskUserQuestionResponse;
    }
    return this.onAskUserQuestion({
      ...request,
      nimbalystSessionId: turn?.nimbalystSessionId,
      workspacePath: turn?.workspacePath,
      signal: turn?.signal,
    });
  }

  private handleExtensionNotification(
    method: string,
    params: Record<string, unknown>,
  ): void {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : undefined;
    const turn = sessionId ? this.activeTurns.get(sessionId) : undefined;
    turn?.queue.push({
      type: 'raw_event',
      metadata: {
        rawEvent: { type: method, sessionId, notification: params },
      },
    });
    // Grok 1.0.5 sends `_x.ai/mcp/servers_updated` during session setup. It is
    // informational; accepting it prevents an otherwise noisy method-not-found
    // response while ACP's session/new or session/load remains authoritative.
  }

  private buildPromptBlocks(message: ProtocolMessage, systemPrompt?: string) {
    const prompt: Array<
      | { type: 'text'; text: string }
      | { type: 'resource'; resource: { uri: string; text: string; mimeType: string } }
    > = [];
    if (systemPrompt) {
      prompt.push({
        type: 'resource',
        resource: {
          uri: 'nimbalyst://system-instructions',
          text: systemPrompt,
          mimeType: 'text/plain',
        },
      });
    }
    prompt.push({ type: 'text', text: message.content });
    return prompt;
  }

  private async cancelPrompt(sessionId: string): Promise<void> {
    if (!this.connection) return;
    const payload: CancelNotification = { sessionId };
    try {
      await this.connection.cancel(payload);
    } catch {
      // Best-effort cancellation only.
    }
  }

  private formatError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingAgentStdioSubcommand(message)) {
      return 'This version of the Grok CLI does not support `grok agent stdio`, '
        + 'which Nimbalyst needs to talk to it. Upgrade Grok, then try again:\n\n'
        + '  curl -fsSL https://x.ai/cli/install.sh | bash';
    }
    if (/not authenticated|not logged in|unauthorized|sign in/i.test(message)) {
      return 'Grok is not signed in. Run `grok login` in your terminal, then try again.';
    }
    if (/ENOENT|spawn/i.test(message)) {
      return 'The Grok CLI was not found. Install it, then run `grok login` to authenticate.';
    }
    return message;
  }
}

export function convertGrokMcpServers(
  mcpServers?: Record<string, MCPServerConfig>,
): McpServer[] {
  if (!mcpServers) return [];

  const converted: McpServer[] = [];
  for (const [name, config] of Object.entries(mcpServers)) {
    const record = config as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url : undefined;
    if (url) {
      const transport = String(record.type ?? record.transport ?? 'http').toLowerCase();
      const headers = Object.entries(
        (record.headers ?? record.http_headers ?? {}) as Record<string, string>,
      ).map(([headerName, value]) => ({ name: headerName, value }));
      converted.push({
        type: transport === 'sse' ? 'sse' : 'http',
        name,
        url,
        headers,
      } as McpServer);
      continue;
    }

    if (typeof config.command !== 'string' || !config.command) continue;
    converted.push({
      name,
      command: config.command,
      args: config.args ?? [],
      env: Object.entries(config.env ?? {})
        .filter(([, value]) => typeof value === 'string')
        .map(([envName, value]) => ({ name: envName, value })),
    });
  }
  return converted;
}

function deriveGrokProviderToolName(toolCall: ToolCallUpdate): string {
  const meta = toolCall._meta?.['x.ai/tool'];
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const name = (meta as Record<string, unknown>).name;
    if (typeof name === 'string' && name) return name;
  }
  const rawInput = toolCall.rawInput;
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    const variant = (rawInput as Record<string, unknown>).variant;
    if (variant === 'Bash') return 'run_terminal_command';
    if (variant === 'SearchReplace') return 'search_replace';
    if (variant === 'Write') return 'write';
  }
  return toolCall.title?.trim() || toolCall.kind || 'unknown';
}

function deriveHostToolName(providerToolName: string, kind?: string | null): string {
  switch (providerToolName) {
    case 'run_terminal_command':
      return 'Bash';
    case 'search_replace':
      return 'Edit';
    case 'write':
      return 'Write';
  }
  switch (kind) {
    case 'execute':
      return 'Bash';
    case 'edit':
      return 'Edit';
    case 'read':
      return 'Read';
    case 'search':
      return 'Grep';
    case 'fetch':
      return 'WebFetch';
    default:
      return providerToolName;
  }
}

function normalizeArguments(rawInput: unknown): Record<string, unknown> | undefined {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }
  return rawInput === undefined ? undefined : { value: rawInput };
}

function selectPermissionOption(
  options: PermissionOption[],
  decision: GrokACPPermissionDecision,
): PermissionOption | undefined {
  const preferredKinds = decision.decision === 'allow'
    ? (decision.scope === 'once' ? ['allow_once', 'allow_always'] : ['allow_always', 'allow_once'])
    : (decision.scope === 'once' ? ['reject_once', 'reject_always'] : ['reject_always', 'reject_once']);
  for (const kind of preferredKinds) {
    const option = options.find((candidate) => candidate.kind === kind);
    if (option) return option;
  }
  return undefined;
}

/**
 * Does this failure mean the installed Grok predates `grok agent stdio`?
 *
 * Detection passes `isInstalled()` — `--version` succeeds on the old CLI — so
 * without this the user gets an opaque init failure with clap's usage text
 * stapled to it. clap prints `error: unrecognized subcommand '<name>'`; the
 * stderr tail rides along on the protocol's own exit error.
 */
export function isMissingAgentStdioSubcommand(message: string): boolean {
  return /unrecognized subcommand|invalid subcommand|unexpected argument/i.test(message)
    && /\bstdio\b|\bagent\b/i.test(message);
}

/** Strip the host's `grok-build:` namespace from a stored model id. */
export function bareGrokModelId(modelId: string): string {
  const separator = modelId.indexOf(':');
  return separator === -1 ? modelId : modelId.slice(separator + 1);
}

/**
 * Token counts for one completed prompt.
 *
 * Grok 1.0.5 does not populate ACP's standard `response.usage`; it reports
 * `response._meta` with its own field names instead, so reading only the
 * standard shape leaves the context chip empty for every ACP grok turn.
 *
 * Cache semantics match `normalizeGrokUsage` in `GrokBuildRecordMapper`, where
 * cached reads count as input — billing fresh input alone understated a real
 * turn by ~15x. The `_meta` shape differs from the `-p` shape in that
 * `inputTokens` ALREADY includes `cachedReadTokens` (observed: 14697 input of
 * which 14592 cached), so folding again would double-count. `totalTokens` is
 * Grok's own running session total and is reported verbatim rather than
 * recomputed — the sum of this turn's parts is a different number.
 */
export function normalizeGrokAcpUsage(response: PromptResponse): ProtocolEvent['usage'] | undefined {
  const standard = response.usage as Usage | null | undefined;
  if (standard) {
    return {
      input_tokens: standard.inputTokens,
      output_tokens: standard.outputTokens,
      total_tokens: standard.totalTokens,
    };
  }

  const meta = response._meta as Record<string, unknown> | null | undefined;
  if (!meta) return undefined;
  const inputTokens = finiteNumber(meta.inputTokens);
  const outputTokens = finiteNumber(meta.outputTokens);
  const totalTokens = finiteNumber(meta.totalTokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  const input = inputTokens ?? Math.max(finiteNumber(meta.cachedReadTokens) ?? 0, 0);
  const output = outputTokens ?? 0;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: totalTokens ?? input + output,
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function resolveGrokCwd(workspacePath: string): Promise<string> {
  try {
    // The legacy `grok -p` path persists sessions under the real path. Passing
    // an unresolved macOS `/tmp` or `/var` alias to ACP makes the same UUID look
    // absent even though its history exists under `/private/...`.
    return await fs.realpath(workspacePath);
  } catch {
    return path.resolve(workspacePath);
  }
}
