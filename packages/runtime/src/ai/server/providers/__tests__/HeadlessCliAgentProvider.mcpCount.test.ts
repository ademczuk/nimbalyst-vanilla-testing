// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentProtocol, ProtocolSession } from '../../protocols/ProtocolInterface';
import type { GrokACPProtocol } from '../../protocols/GrokACPProtocol';
import { BaseAgentProvider } from '../BaseAgentProvider';
import { GrokBuildProvider } from '../GrokBuildProvider';

function protocolWithDelivery(
  deliveredMcpServerCount?: number,
  appliedModel?: string,
): GrokACPProtocol {
  const session = (): ProtocolSession => ({
    id: 'grok-session',
    platform: 'test',
    ...(deliveredMcpServerCount === undefined ? {} : { deliveredMcpServerCount }),
    ...(appliedModel === undefined ? {} : { appliedModel }),
  });
  const protocol: AgentProtocol = {
    platform: 'test',
    createSession: vi.fn(async () => session()),
    resumeSession: vi.fn(async () => session()),
    forkSession: vi.fn(async () => session()),
    async *sendMessage() {
      yield { type: 'complete' as const };
    },
    abortSession: vi.fn(),
    cleanupSession: vi.fn(),
  };
  return {
    ...protocol,
    setGrokPath: vi.fn(),
    setProcessEnv: vi.fn(),
    setAskUserQuestionHandler: vi.fn(),
  } as unknown as GrokACPProtocol;
}

async function runProvider(protocol: GrokACPProtocol): Promise<GrokBuildProvider> {
  BaseAgentProvider.setTrustChecker(() => ({ trusted: true, mode: 'allow-all' }));
  GrokBuildProvider.setMCPConfigLoader(async () => ({
    stdio: { command: 'node', args: ['server.js'] },
    remote: { type: 'http', url: 'http://127.0.0.1:41001/mcp' },
  }));
  GrokBuildProvider.setGrokPathLoader(() => '/usr/bin/true');
  const provider = new GrokBuildProvider({ protocol });
  await provider.initialize({ model: 'grok-build:grok-4.6' });
  const chunks = [];
  for await (const chunk of provider.sendMessage('hello', undefined, undefined, undefined, '/tmp')) chunks.push(chunk);
  if (!provider.getInitData()) throw new Error(`Provider did not initialize: ${JSON.stringify(chunks)}`);
  return provider;
}

afterEach(() => {
  BaseAgentProvider.setTrustChecker(null);
  GrokBuildProvider.setMCPConfigLoader(null);
  GrokBuildProvider.setGrokPathLoader(null);
  GrokBuildProvider.setShellEnvironmentLoader(null);
  GrokBuildProvider.setEnhancedPathLoader(null);
});

describe('HeadlessCliAgentProvider MCP delivery count', () => {
  it('reports the count supplied by a delivering protocol', async () => {
    const provider = await runProvider(protocolWithDelivery(2));
    expect(provider.getInitData()?.mcpServerCount).toBe(2);
  });

  it('reports zero when a protocol does not declare any delivered servers', async () => {
    const provider = await runProvider(protocolWithDelivery());
    expect(provider.getInitData()?.mcpServerCount).toBe(0);
  });

  it('reports the model the protocol applied, not the one that was requested', async () => {
    // The turn is configured for grok-4.6 but the protocol reports grok-4.5 as
    // live. Reporting a model the agent did not run is worse than not offering
    // the choice, so the protocol's observation wins.
    const provider = await runProvider(protocolWithDelivery(0, 'grok-4.5'));
    expect(provider.getInitData()?.model).toBe('grok-4.5');
  });

  it('falls back to the requested model when the protocol cannot observe one', async () => {
    const provider = await runProvider(protocolWithDelivery(0));
    expect(provider.getInitData()?.model).toBe('grok-build:grok-4.6');
  });
});
