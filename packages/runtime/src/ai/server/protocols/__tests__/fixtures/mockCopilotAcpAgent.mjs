#!/usr/bin/env node

/**
 * Mock Copilot ACP agent for CopilotACPProtocol.test.ts. Speaks the same raw
 * JSON-RPC-over-stdio framing the protocol implements by hand (no SDK), and
 * answers just enough of the handshake for `createSession()` to resolve.
 *
 * Its real job is the env audit below: what a child spawned by
 * CopilotACPProtocol actually inherited.
 */

import fs from 'node:fs';
import { createInterface } from 'node:readline';

// The only honest observation point for what the child was actually spawned
// with. Asserting on the map the provider *built* passes even when the spawn
// site falls back to an unscrubbed `process.env`.
const auditPath = process.env.COPILOT_ACP_TEST_AUDIT_PATH;
if (auditPath) {
  fs.appendFileSync(auditPath, `${JSON.stringify({
    method: 'process:env',
    params: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null,
      XAI_API_KEY: process.env.XAI_API_KEY ?? null,
      COPILOT_ACP_TEST_PASSTHROUGH: process.env.COPILOT_ACP_TEST_PASSTHROUGH ?? null,
    },
  })}\n`, 'utf8');
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof message.id !== 'number') return;

  const result = message.method === 'session/new'
    ? { sessionId: 'mock-copilot-session' }
    : {};
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
});
