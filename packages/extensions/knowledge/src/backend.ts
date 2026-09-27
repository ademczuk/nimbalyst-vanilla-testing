/**
 * Knowledge extension backend module (Electron utility process).
 *
 * Hosts the curator's Jev sorter. It lives here rather than in the renderer
 * because api.typesafe.ai rejects the app's origin under CORS.
 *
 * Jev runs on TypeSafe or on Cloudflare Workers AI. Credentials come only from
 * the `getApiKey` broker, which reads the encrypted credentials the settings
 * panel saved. Never `process.env`.
 *
 * Method names below must match the names passed to registerMcpTools; the host
 * advertises them as `knowledge.<name>`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_THRESHOLDS,
  JEV_MODEL,
  JevError,
  callJev,
  type JevRequest,
  parseCloudflareCredential,
  sortEvent,
  type CuratorArea,
  type CuratorCandidate,
  type CuratorEvent,
  type JevProvider,
  type SortResult,
  type SortThresholds,
} from './curator/jevSorter';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface ActivateCtx {
  services: {
    dataDir: string;
    log: (level: LogLevel, message: string, data?: unknown) => void;
    getApiKey: (providerId: string) => Promise<{ key: string | null }>;
    registerMcpTools: (
      tools: Array<{ name: string; description?: string; inputSchema?: unknown; scope?: 'global' | 'editor' }>
    ) => Promise<{ registered: string[] }>;
  };
}

export const TYPESAFE_CREDENTIAL = 'typesafe';
/** JSON `{ accountId, apiToken, gatewayId? }`; see parseCloudflareCredential. */
export const CLOUDFLARE_CREDENTIAL = 'cloudflare-workers-ai';
/** USD per input token for jev-1.13 ($0.042 per million). Output is free. */
const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
const CONCURRENCY = 4;

type SortEventInput = CuratorEvent & { candidates?: CuratorCandidate[] };

const TOOLS = [
  {
    name: 'sort_events',
    description:
      'Knowledge curator sorter. For each work event (commit, session, tracker change), asks the Jev decision model whether it carries durable knowledge, which wiki area it belongs to, and which existing item it is about (or "new"), and whether it contradicts that claim. Returns a verdict per event: create, update, supersede, or drop with a reason. Only confident answers pass. Requires a TypeSafe API key or a Cloudflare Workers AI token in Settings > Knowledge curator. Every decision is logged locally for evaluation.',
    inputSchema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          description: 'Events to sort. Keep text to the relevant part; long state lowers accuracy.',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: 'Commit SHA, session id, or tracker key' },
              kind: { type: 'string', enum: ['commit', 'session', 'tracker-change'] },
              title: { type: 'string' },
              text: { type: 'string' },
              paths: { type: 'array', items: { type: 'string' } },
              candidates: {
                type: 'array',
                description: 'Existing wiki items this event might be about (retrieved by search), at most ~20.',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    kind: { type: 'string', enum: ['entity', 'claim', 'question', 'finding'] },
                    title: { type: 'string' },
                    statement: { type: 'string' },
                  },
                  required: ['id', 'kind', 'title'],
                },
              },
            },
            required: ['ref', 'kind', 'title', 'text'],
          },
        },
        areas: {
          type: 'array',
          description: 'Wiki areas (entities with kind: area).',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' } },
            required: ['id', 'title'],
          },
        },
        guidance: { type: 'string', description: "What belongs in this wiki, from the project's wiki guide." },
        thresholds: {
          type: 'object',
          description: 'Override gates (0-1): knowledge, area, target, contradiction.',
          properties: {
            knowledge: { type: 'number' },
            area: { type: 'number' },
            target: { type: 'number' },
            contradiction: { type: 'number' },
          },
        },
      },
      required: ['events', 'areas'],
    },
  },
  {
    name: 'ask_jev',
    description:
      'Ask the Jev decision model your own typed questions about one or more states, e.g. to screen drafted wiki items before writing them. Each question is noul (yes/no probability; criteria {true,false}), choice (criteria {option: description}), or score (criteria: ordered labels). Returns raw answers with probabilities and confidence; nothing is gated or logged. Keep each state short and relevant.',
    inputSchema: {
      type: 'object',
      properties: {
        requests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              state: { description: 'String or object to judge' },
              questions: { type: 'object', description: 'Question key -> { type, instructions, criteria }' },
            },
            required: ['ref', 'state', 'questions'],
          },
        },
      },
      required: ['requests'],
    },
  },
  {
    name: 'curator_status',
    description: 'Which Jev provider is configured (TypeSafe or Cloudflare), and how many sorter decisions have been logged.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export async function activate(ctx: ActivateCtx) {
  const { dataDir, log, getApiKey, registerMcpTools } = ctx.services;
  mkdirSync(dataDir, { recursive: true });
  const decisionLog = path.join(dataDir, 'curator-decisions.jsonl');

  async function readCredential(name: string): Promise<string | null> {
    try {
      return (await getApiKey(name)).key;
    } catch {
      return null;
    }
  }

  // Read per call, not at activation, so a key saved after startup is picked up.
  // TypeSafe wins when both are saved because it is the only one that pins the version.
  async function readProvider(): Promise<JevProvider | null> {
    const apiKey = await readCredential(TYPESAFE_CREDENTIAL);
    if (apiKey) return { kind: 'typesafe', apiKey };
    return parseCloudflareCredential(await readCredential(CLOUDFLARE_CREDENTIAL));
  }

  await registerMcpTools(TOOLS.map((t) => ({ ...t, scope: 'global' as const })));

  return {
    methods: {
      sort_events: async (params: {
        events?: SortEventInput[];
        areas?: CuratorArea[];
        guidance?: string;
        thresholds?: Partial<SortThresholds>;
      }) => {
        const events = Array.isArray(params?.events) ? params.events : [];
        const areas = Array.isArray(params?.areas) ? params.areas : [];
        if (!events.length) throw new Error('events is required');
        if (!areas.length) throw new Error('areas is required: list the wiki area entities');
        const provider = await readProvider();
        if (!provider) {
          throw new Error('No Jev provider. Add a TypeSafe API key or Cloudflare Workers AI token in Settings > Knowledge curator.');
        }
        const thresholds = { ...DEFAULT_THRESHOLDS, ...(params.thresholds ?? {}) };

        const auth: { failure: JevError | null } = { failure: null };
        const results = await mapLimit(events, CONCURRENCY, async (event) => {
          if (auth.failure) return { ref: event.ref, error: 'skipped after authentication failure' };
          try {
            return await sortEvent(
              event,
              { areas, candidates: event.candidates ?? [], guidance: params.guidance },
              { provider, fetch, thresholds }
            );
          } catch (err) {
            if (err instanceof JevError && (err.status === 401 || err.status === 403)) auth.failure = err;
            return { ref: event.ref, error: (err as Error).message };
          }
        });
        if (auth.failure) throw auth.failure;

        const sorted = results.filter((r): r is SortResult => 'decision' in r);
        const at = new Date().toISOString();
        const lines = sorted.map((r) => {
          const event = events.find((e) => e.ref === r.ref);
          return JSON.stringify({ at, ref: r.ref, kind: event?.kind, title: event?.title, model: r.model, thresholds, decision: r.decision });
        });
        if (lines.length) appendFileSync(decisionLog, lines.join('\n') + '\n');

        const inputTokens = sorted.reduce((n, r) => n + r.inputTokens, 0);
        const dropped: Record<string, number> = {};
        for (const r of sorted) {
          if (r.decision.verdict === 'drop') dropped[r.decision.reason] = (dropped[r.decision.reason] ?? 0) + 1;
        }
        log('info', `[knowledge] sorted ${sorted.length}/${events.length} event(s) via ${provider.kind}, ${inputTokens} input tokens`);
        const models = [...new Set(sorted.map((r) => r.model))];
        const unpinnedModels = models.filter((m) => m !== JEV_MODEL);
        if (unpinnedModels.length) {
          log('warn', `[knowledge] Jev returned ${unpinnedModels.join(', ')}; thresholds were chosen against ${JEV_MODEL}`);
        }
        return {
          results,
          summary: {
            provider: provider.kind,
            models,
            ...(unpinnedModels.length
              ? { warning: `Jev ${unpinnedModels.join(', ')} answered, but the thresholds were chosen against ${JEV_MODEL}. Check verdicts before trusting them.` }
              : {}),
            sorted: sorted.length,
            errors: results.length - sorted.length,
            passed: sorted.filter((r) => r.decision.verdict !== 'drop').length,
            dropped,
            inputTokens,
            costUsd: Number((inputTokens * JEV_USD_PER_INPUT_TOKEN).toFixed(6)),
            thresholds,
          },
        };
      },

      ask_jev: async (params: { requests?: Array<{ ref: string; state: unknown; questions: JevRequest['questions'] }> }) => {
        const requests = Array.isArray(params?.requests) ? params.requests : [];
        if (!requests.length) throw new Error('requests is required');
        const provider = await readProvider();
        if (!provider) {
          throw new Error('No Jev provider. Add a TypeSafe API key or Cloudflare Workers AI token in Settings > Knowledge curator.');
        }
        const auth: { failure: JevError | null } = { failure: null };
        const results = await mapLimit(requests, CONCURRENCY, async (r) => {
          if (auth.failure) return { ref: r.ref, error: 'skipped after authentication failure' };
          try {
            const res = await callJev({ state: r.state, questions: r.questions }, { provider, fetch });
            return { ref: r.ref, model: res.model, answers: res.answers, inputTokens: res.usage?.input_tokens ?? 0 };
          } catch (err) {
            if (err instanceof JevError && (err.status === 401 || err.status === 403)) auth.failure = err;
            return { ref: r.ref, error: (err as Error).message };
          }
        });
        if (auth.failure) throw auth.failure;
        const inputTokens = results.reduce((n, r) => n + ('inputTokens' in r ? (r.inputTokens ?? 0) : 0), 0);
        log('info', `[knowledge] ask_jev ${requests.length} request(s) via ${provider.kind}, ${inputTokens} input tokens`);
        return { results, summary: { provider: provider.kind, inputTokens, costUsd: Number((inputTokens * JEV_USD_PER_INPUT_TOKEN).toFixed(6)) } };
      },

      curator_status: async () => {
        const logged = existsSync(decisionLog)
          ? readFileSync(decisionLog, 'utf-8').split('\n').filter(Boolean).length
          : 0;
        const provider = await readProvider();
        const cloudflare = parseCloudflareCredential(await readCredential(CLOUDFLARE_CREDENTIAL));
        return {
          keyConfigured: Boolean(provider),
          provider: provider?.kind ?? null,
          typesafeConfigured: Boolean(await readCredential(TYPESAFE_CREDENTIAL)),
          cloudflareConfigured: Boolean(cloudflare),
          // Not secrets: shown back in settings so a saved form does not look empty. The token never leaves.
          cloudflareAccountId: cloudflare?.kind === 'cloudflare' ? cloudflare.accountId : null,
          cloudflareGatewayId: cloudflare?.kind === 'cloudflare' ? (cloudflare.gatewayId ?? null) : null,
          decisionsLogged: logged,
          decisionLog,
        };
      },
    },
  };
}
