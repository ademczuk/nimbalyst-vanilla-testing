// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  buildJevRequest,
  callJev,
  interpretJevResponse,
  parseCloudflareCredential,
  type JevResponse,
  type SortContext,
} from '../src/curator/jevSorter';

const ctx: SortContext = {
  areas: [{ id: 'area-product', title: 'Product' }],
  candidates: [
    { id: 'claim-1', kind: 'claim', title: 'Sync uses PGLite', statement: 'Desktop sync stores state in PGLite' },
    { id: 'ent-1', kind: 'entity', title: 'Desktop app' },
  ],
};

function answers(knowledge: number, area: [string, number], target: [string, number], contradicts?: number): JevResponse {
  return {
    model: 'jev-1.13.0',
    answers: {
      knowledge: { type: 'noul', noul: knowledge },
      area: { type: 'choice', choice: area[0], probabilities: {}, confidence: area[1] },
      target: { type: 'choice', choice: target[0], probabilities: {}, confidence: target[1] },
      ...(contradicts === undefined ? {} : { 'contradicts:claim-1': { type: 'noul' as const, noul: contradicts } }),
    },
  };
}

describe('Jev sorter', () => {
  it('asks a contradiction check only for claim candidates, and gates every step on confidence', () => {
    const req = buildJevRequest({ ref: 'abc123', kind: 'commit', title: 'Move sync to SQLite', text: 'x' }, ctx);
    expect(Object.keys(req.questions).sort()).toEqual(['area', 'contradicts:claim-1', 'knowledge', 'target']);
    expect(Object.keys((req.questions.target as { criteria: object }).criteria)).toEqual(['claim-1', 'ent-1', 'new']);

    const verdict = (r: JevResponse) => {
      const d = interpretJevResponse(r, ctx);
      return d.verdict === 'drop' ? `drop:${d.reason}` : d.verdict;
    };
    expect(verdict(answers(0.2, ['area-product', 0.9], ['new', 0.9]))).toBe('drop:not-knowledge');
    expect(verdict(answers(0.7, ['area-product', 0.9], ['new', 0.9]))).toBe('drop:uncertain-knowledge');
    expect(verdict(answers(0.9, ['none', 0.9], ['new', 0.9]))).toBe('drop:no-area');
    expect(verdict(answers(0.9, ['area-product', 0.4], ['new', 0.9]))).toBe('drop:uncertain-area');
    // A shaky "new" is dropped, not created: that is how duplicates get in.
    expect(verdict(answers(0.9, ['area-product', 0.9], ['new', 0.5]))).toBe('drop:uncertain-target');
    expect(verdict(answers(0.9, ['area-product', 0.9], ['new', 0.9]))).toBe('create');
    expect(verdict(answers(0.9, ['area-product', 0.9], ['ent-1', 0.9]))).toBe('update');
    expect(verdict(answers(0.9, ['area-product', 0.9], ['claim-1', 0.9], 0.5))).toBe('update');
    expect(verdict(answers(0.9, ['area-product', 0.9], ['claim-1', 0.9], 0.95))).toBe('supersede');
  });

  it('retries 429/529 honoring retry-after, and fails fast on other errors', async () => {
    const reply = (status: number, body: unknown, retryAfter?: string) => ({
      ok: status === 200,
      status,
      headers: { get: (h: string) => (h === 'retry-after' ? retryAfter ?? null : null) },
      text: async () => JSON.stringify(body),
    });
    const waits: number[] = [];
    const queue = [reply(429, {}, '2'), reply(529, {}), reply(200, answers(0.9, ['area-product', 0.9], ['new', 0.9]))];
    const res = await callJev(buildJevRequest({ ref: 'r', kind: 'commit', title: 't', text: 'x' }, ctx), {
      provider: { kind: 'typesafe', apiKey: 'k' },
      fetch: async () => queue.shift()!,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(res.answers.knowledge).toEqual({ type: 'noul', noul: 0.9 });
    expect(waits).toEqual([2000, 1000]);

    await expect(
      callJev(buildJevRequest({ ref: 'r', kind: 'commit', title: 't', text: 'x' }, ctx), {
        provider: { kind: 'typesafe', apiKey: 'bad' },
        fetch: async () => reply(401, { detail: 'no key' }),
        sleep: async () => {},
      })
    ).rejects.toMatchObject({ status: 401 });
  });

  it('calls Cloudflare Workers AI with the model in the body, through a gateway when named, and unwraps the envelope', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const reply = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    const fetch = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return queue.shift()!;
    };
    // The shape observed live on 2026-09-25: a job wrapper inside the API envelope.
    const live = (inner: JevResponse, state = 'Completed') => ({
      result: { state, result: inner, gatewayMetadata: { keySource: 'Unified' } },
      success: true,
      errors: [],
      messages: [],
    });
    const inner = answers(0.9, ['area-product', 0.9], ['new', 0.9]);
    const queue = [
      reply(live(inner)),
      reply(live(inner)),
      reply(live(inner, 'Failed')),
      reply({ success: false, errors: [{ code: 5006, message: 'bad input' }], result: null }),
    ];
    const req = buildJevRequest({ ref: 'r', kind: 'commit', title: 't', text: 'x' }, ctx);

    const direct = parseCloudflareCredential(JSON.stringify({ accountId: 'acct', apiToken: 'tok' }));
    const res = await callJev(req, { provider: direct!, fetch });
    expect(res.answers.knowledge).toEqual({ type: 'noul', noul: 0.9 });
    // The model goes in the body, not the path: `/ai/run/typesafe/jev` answers 7000 "No route for that URI".
    expect(calls[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run');
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
    expect(calls[0].headers['cf-aig-gateway-id']).toBeUndefined();
    // Cloudflare's input schema rejects anything but state and questions.
    expect(calls[0].body.model).toBe('typesafe/jev');
    expect(Object.keys(calls[0].body.input as object).sort()).toEqual(['questions', 'state']);

    const viaGateway = parseCloudflareCredential(JSON.stringify({ accountId: 'acct', apiToken: 'tok', gatewayId: 'kg' }));
    await callJev(req, { provider: viaGateway!, fetch });
    expect(calls[1].url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run');
    expect(calls[1].headers['cf-aig-gateway-id']).toBe('kg');

    await expect(callJev(req, { provider: direct!, fetch })).rejects.toThrow(/Failed/);
    await expect(callJev(req, { provider: direct!, fetch })).rejects.toThrow(/bad input/);
    expect(parseCloudflareCredential('{"accountId":"acct"}')).toBeNull();
  });
});
