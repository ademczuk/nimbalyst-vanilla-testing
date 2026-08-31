#!/usr/bin/env node

import fs from 'node:fs';
import { Readable, Writable } from 'node:stream';
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
} from '@agentclientprotocol/sdk';

const auditPath = process.env.GROK_ACP_TEST_AUDIT_PATH;

function audit(method, params) {
  if (!auditPath) return;
  fs.appendFileSync(auditPath, `${JSON.stringify({ method, params })}\n`, 'utf8');
}

// The only honest observation point for what the child was actually spawned
// with. Asserting on the map the provider *built* passes even when the spawn
// site merges process.env back over it.
audit('process:env', {
  XAI_API_KEY: process.env.XAI_API_KEY ?? null,
  GROK_API_KEY: process.env.GROK_API_KEY ?? null,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null,
  GROK_ACP_TEST_PASSTHROUGH: process.env.GROK_ACP_TEST_PASSTHROUGH ?? null,
});

const MODELS = {
  currentModelId: 'grok-4.6',
  availableModels: [
    { modelId: 'grok-4.6', name: 'Grok 4.6', _meta: { totalContextTokens: 500000 } },
    { modelId: 'grok-4.5', name: 'Grok 4.5', _meta: { totalContextTokens: 500000 } },
  ],
};

class MockGrokAcpAgent {
  constructor(connection) {
    this.connection = connection;
    this.sessions = new Map();
    this.currentModelId = MODELS.currentModelId;
  }

  /** Grok 1.0.5 answers `{_meta:{model:{Ok:"<id>"}}}` and errors on an unknown id. */
  async unstable_setSessionModel(params) {
    audit('session/set_model', params);
    if (!MODELS.availableModels.some((model) => model.modelId === params.modelId)) {
      throw new Error('unknown model id');
    }
    this.currentModelId = params.modelId;
    return { _meta: { model: { Ok: params.modelId } } };
  }

  async initialize(params) {
    audit('initialize', params);
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: false, audio: false, embeddedContext: true },
        mcpCapabilities: { http: true, sse: true },
        sessionCapabilities: { list: {}, resume: {}, close: {} },
      },
      auth: {},
      _meta: { 'x.ai/fs_notify': true },
    };
  }

  async newSession(params) {
    audit('session/new', params);
    const sessionId = 'new-grok-session';
    this.sessions.set(sessionId, params);
    return { sessionId, models: { ...MODELS, currentModelId: this.currentModelId } };
  }

  async loadSession(params) {
    audit('session/load', params);
    if (params.sessionId !== 'legacy-p-session') {
      throw new Error(`Unexpected persisted session: ${params.sessionId}`);
    }
    this.sessions.set(params.sessionId, params);
    await this.connection.extNotification('_x.ai/mcp/servers_updated', {
      mcpServers: params.mcpServers,
    });
    return { models: { ...MODELS, currentModelId: this.currentModelId } };
  }

  async prompt(params) {
    audit('session/prompt', params);
    if (!this.sessions.has(params.sessionId)) {
      throw new Error(`Unknown session: ${params.sessionId}`);
    }

    const text = (params.prompt ?? []).map((block) => block.text ?? '').join(' ');
    if (text.includes('ASK_QUESTION')) {
      // The captured `_x.ai/ask_user_question` shape: Grok's own question tool
      // reaching the client as an answerable extension request.
      const answer = await this.connection.extMethod('_x.ai/ask_user_question', {
        sessionId: params.sessionId,
        toolCallId: 'call-question-0',
        questions: [{
          question: 'Choose one',
          options: [{ label: 'Alpha' }, { label: 'Beta' }],
          multiSelect: false,
        }],
      });
      audit('_x.ai/ask_user_question:response', answer);
      return { stopReason: 'end_turn' };
    }

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Waiting for permission' },
      },
    });

    const permission = await this.connection.requestPermission({
      sessionId: params.sessionId,
      toolCall: {
        toolCallId: 'call-6e798cf0-803c-413f-82d5-ab4ada283d4d-0',
        kind: 'execute',
        title: 'Execute `touch /private/tmp/nimbalyst-grok-acp-permission-probe`',
        rawInput: {
          variant: 'Bash',
          command: 'touch /private/tmp/nimbalyst-grok-acp-permission-probe',
          description: 'Create ACP permission probe file',
          is_background: false,
        },
        _meta: {
          'x.ai/tool': {
            version: 1,
            name: 'run_terminal_command',
            kind: 'execute',
            namespace: 'grok_build',
            label: 'Run Command',
            read_only: false,
          },
        },
      },
      options: [
        { optionId: 'allow-once', name: 'Yes, proceed', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'No', kind: 'reject_once' },
      ],
    });
    audit('session/request_permission:response', permission);

    if (permission.outcome.outcome !== 'selected' || permission.outcome.optionId !== 'allow-once') {
      return { stopReason: 'cancelled' };
    }

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-e891afa0-d80b-4724-9f2a-a6703b3dacd6-0',
        status: 'completed',
        content: [{
          type: 'diff',
          path: '/private/tmp/nimbalyst-grok-acp-edit.XuwVSl/acp-edit.txt',
          oldText: '',
          newText: 'alpha\n',
        }],
        rawOutput: {
          type: 'SearchReplace',
          EditsApplied: {
            old_string: '',
            new_string: 'alpha\n',
            absolute_path: '/private/tmp/nimbalyst-grok-acp-edit.XuwVSl/acp-edit.txt',
          },
        },
      },
    });

    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Permission accepted' },
      },
    });

    return {
      stopReason: 'end_turn',
      _meta: {
        sessionId: params.sessionId,
        totalTokens: 14737,
        modelId: 'grok-4.6',
        inputTokens: 14697,
        outputTokens: 38,
        cachedReadTokens: 14592,
        reasoningTokens: 29,
      },
    };
  }

  async cancel(params) {
    audit('session/cancel', params);
  }
}

const stream = ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);

new AgentSideConnection((connection) => new MockGrokAcpAgent(connection), stream);
