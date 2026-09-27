/**
 * Knowledge curator sorter backed by TypeSafe's Jev decision model.
 *
 * The curator asks a fixed set of typed questions about each work event
 * (commit, session, tracker change) and only lets confident answers through to
 * the writer. Jev answers yes/no and choice questions with probabilities, so the
 * gating lives here in code: the model reports, the thresholds decide.
 *
 * One request per event. Every question is asked in that request, including the
 * speculative per-claim contradiction checks, because Jev reads the state once
 * and prices by input tokens only.
 */

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/**
 * Pinned, not `jev-latest`: the thresholds below were chosen against this version.
 * Cloudflare serves `typesafe/jev` with no way to pin, so callers compare the
 * returned `model` against this instead.
 */
export const JEV_MODEL = 'jev-1.13.0';
export const CLOUDFLARE_JEV_MODEL = 'typesafe/jev';
/** Jev accuracy drops as irrelevant state grows; commits and session replies can be long. */
export const MAX_EVENT_TEXT_CHARS = 6000;

export type CuratorEventKind = 'commit' | 'session' | 'tracker-change';

export interface CuratorEvent {
  /** Stable source ref: commit SHA, session id, or tracker key plus revision. */
  ref: string;
  kind: CuratorEventKind;
  title: string;
  text: string;
  paths?: string[];
}

export interface CuratorArea {
  id: string;
  title: string;
  summary?: string;
}

export interface CuratorCandidate {
  id: string;
  kind: 'entity' | 'claim' | 'question' | 'finding';
  title: string;
  statement?: string;
}

export interface SortContext {
  areas: CuratorArea[];
  /** Existing items retrieved for this event; the sorter picks one or "new". */
  candidates: CuratorCandidate[];
  /** What belongs in this wiki, from the project's wiki guide. Optional. */
  guidance?: string;
}

export interface SortThresholds {
  /** Minimum P(yes) that the event carries durable knowledge. */
  knowledge: number;
  /** Minimum confidence in the chosen area. */
  area: number;
  /** Minimum confidence in the chosen target (existing item or "new"). */
  target: number;
  /** Minimum P(yes) that the event contradicts the chosen claim. */
  contradiction: number;
}

/** Conservative defaults: a pass writes straight into the graph, with no review step. */
export const DEFAULT_THRESHOLDS: SortThresholds = {
  knowledge: 0.8,
  area: 0.6,
  target: 0.6,
  contradiction: 0.8,
};

export type DropReason =
  | 'not-knowledge'
  | 'uncertain-knowledge'
  | 'no-area'
  | 'uncertain-area'
  | 'uncertain-target';

export type SortDecision =
  | { verdict: 'drop'; reason: DropReason; signals: SortSignals }
  | { verdict: 'create'; areaId: string; signals: SortSignals }
  | { verdict: 'update'; areaId: string; targetId: string; signals: SortSignals }
  | { verdict: 'supersede'; areaId: string; targetId: string; signals: SortSignals };

export interface SortSignals {
  knowledge: number;
  area?: { choice: string; confidence: number };
  target?: { choice: string; confidence: number };
  contradiction?: number;
}

const NONE = 'none';
const NEW = 'new';

type JevQuestion =
  | { type: 'noul'; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
  | { type: 'choice'; instructions: unknown; criteria: Record<string, unknown> };

/** Provider-neutral: TypeSafe also takes `model`, Cloudflare rejects any extra field. */
export interface JevRequest {
  state: unknown;
  questions: Record<string, JevQuestion>;
}

export interface JevResponse {
  model: string;
  answers: Record<
    string,
    | { type: 'noul'; noul: number }
    | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  >;
  usage?: { input_tokens: number; output_tokens: number };
}

function contradictionKey(candidateId: string): string {
  return `contradicts:${candidateId}`;
}

export function buildJevRequest(event: CuratorEvent, ctx: SortContext): JevRequest {
  const text =
    event.text.length > MAX_EVENT_TEXT_CHARS
      ? `${event.text.slice(0, MAX_EVENT_TEXT_CHARS)}\n[truncated]`
      : event.text;
  const state = {
    event: {
      kind: event.kind,
      title: event.title,
      text,
      ...(event.paths?.length ? { paths: event.paths.slice(0, 40) } : {}),
    },
  };

  const areaCriteria: Record<string, unknown> = {};
  for (const area of ctx.areas) {
    areaCriteria[area.id] = area.summary ? { title: area.title, covers: area.summary } : area.title;
  }
  areaCriteria[NONE] = 'None of these areas fits the event.';

  const targetCriteria: Record<string, unknown> = {};
  for (const c of ctx.candidates) {
    targetCriteria[c.id] = c.statement ? { kind: c.kind, title: c.title, statement: c.statement } : { kind: c.kind, title: c.title };
  }
  targetCriteria[NEW] = 'The event is about something none of the existing items covers.';

  const questions: Record<string, JevQuestion> = {
    knowledge: {
      type: 'noul',
      instructions: ctx.guidance
        ? { wiki_guide: ctx.guidance, question: 'Does `event` change what the team knows, as `wiki_guide` defines what belongs in the wiki?' }
        : 'Does `event` change what the team knows?',
      criteria: {
        true: 'A decision was made, a behavior was established or measured, a direction was dropped, a fact about a product or market was learned, or a question was answered or raised.',
        false: 'Routine work: a refactor, test fix, dependency bump, typo, formatting, work in progress, or anything with no lasting fact in it.',
      },
    },
    area: {
      type: 'choice',
      instructions: 'Which wiki area does the knowledge in `event` belong to?',
      criteria: areaCriteria,
    },
    target: {
      type: 'choice',
      instructions: 'Which existing wiki item is `event` about?',
      criteria: targetCriteria,
    },
  };

  for (const c of ctx.candidates) {
    if (c.kind !== 'claim') continue;
    questions[contradictionKey(c.id)] = {
      type: 'noul',
      instructions: {
        existing_claim: c.statement ?? c.title,
        question: 'Does `event` show that `existing_claim` is no longer true?',
      },
    };
  }

  return { state, questions };
}

function noul(res: JevResponse, key: string): number | undefined {
  const a = res.answers[key];
  return a && a.type === 'noul' ? a.noul : undefined;
}

function choice(res: JevResponse, key: string): { choice: string; confidence: number } | undefined {
  const a = res.answers[key];
  return a && a.type === 'choice' ? { choice: a.choice, confidence: a.confidence } : undefined;
}

export function interpretJevResponse(
  res: JevResponse,
  ctx: SortContext,
  thresholds: SortThresholds = DEFAULT_THRESHOLDS
): SortDecision {
  const knowledge = noul(res, 'knowledge');
  if (knowledge === undefined) throw new Error('Jev response is missing the knowledge answer');
  const area = choice(res, 'area');
  const target = choice(res, 'target');
  const signals: SortSignals = { knowledge, area, target };

  if (knowledge < 0.5) return { verdict: 'drop', reason: 'not-knowledge', signals };
  if (knowledge < thresholds.knowledge) return { verdict: 'drop', reason: 'uncertain-knowledge', signals };
  if (!area || area.choice === NONE) return { verdict: 'drop', reason: 'no-area', signals };
  if (area.confidence < thresholds.area) return { verdict: 'drop', reason: 'uncertain-area', signals };
  // A low-confidence "new" is as dangerous as a low-confidence match: it is
  // how the graph fills with duplicates.
  if (!target || target.confidence < thresholds.target) return { verdict: 'drop', reason: 'uncertain-target', signals };
  if (target.choice === NEW) return { verdict: 'create', areaId: area.choice, signals };

  const chosen = ctx.candidates.find((c) => c.id === target.choice);
  if (chosen?.kind === 'claim') {
    const contradiction = noul(res, contradictionKey(chosen.id));
    signals.contradiction = contradiction;
    if (contradiction !== undefined && contradiction >= thresholds.contradiction) {
      return { verdict: 'supersede', areaId: area.choice, targetId: chosen.id, signals };
    }
  }
  return { verdict: 'update', areaId: area.choice, targetId: target.choice, signals };
}

export class JevError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/**
 * Where Jev runs. TypeSafe is invite-only; Cloudflare Workers AI hosts the same
 * model billed to the user's Cloudflare account, optionally through an AI Gateway.
 */
export type JevProvider =
  | { kind: 'typesafe'; apiKey: string }
  | { kind: 'cloudflare'; accountId: string; apiToken: string; gatewayId?: string };

/** The Cloudflare credential is saved as one JSON string so it lives in a single encrypted slot. */
export function parseCloudflareCredential(raw: string | null | undefined): JevProvider | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { accountId?: unknown; apiToken?: unknown; gatewayId?: unknown };
    if (typeof v.accountId !== 'string' || !v.accountId || typeof v.apiToken !== 'string' || !v.apiToken) return null;
    const gatewayId = typeof v.gatewayId === 'string' && v.gatewayId ? v.gatewayId : undefined;
    return { kind: 'cloudflare', accountId: v.accountId, apiToken: v.apiToken, gatewayId };
  } catch {
    return null;
  }
}

function jevHttpRequest(
  req: JevRequest,
  provider: JevProvider
): { url: string; headers: Record<string, string>; body: unknown } {
  if (provider.kind === 'typesafe') {
    return { url: JEV_ENDPOINT, headers: { Authorization: `Bearer ${provider.apiKey}` }, body: { model: JEV_MODEL, ...req } };
  }
  // Partner models take the model name in the body; `/ai/run/<model>` does not route for them.
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(provider.accountId)}/ai/run`,
    headers: {
      Authorization: `Bearer ${provider.apiToken}`,
      ...(provider.gatewayId ? { 'cf-aig-gateway-id': provider.gatewayId } : {}),
    },
    body: { model: CLOUDFLARE_JEV_MODEL, input: req },
  };
}

/** Cloudflare wraps the answer in `{ success, errors, result: { state, result } }`; TypeSafe returns it bare. */
function unwrapJevResponse(raw: string, status: number): JevResponse {
  const parsed = JSON.parse(raw) as unknown;
  const env = parsed as { success?: boolean; errors?: Array<{ message?: string }>; result?: unknown };
  let out = parsed;
  if (env && typeof env === 'object' && 'success' in env) {
    if (!env.success || !env.result) {
      const message = (env.errors ?? []).map((e) => e.message).filter(Boolean).join('; ') || 'no result';
      throw new JevError(status, `Jev request failed: ${message}`);
    }
    out = env.result;
    // Partner models add a job wrapper: `{ state: 'Completed', result: {...}, gatewayMetadata }`.
    const job = out as { state?: unknown; result?: unknown };
    if (job && typeof job === 'object' && typeof job.state === 'string' && 'result' in job) {
      if (job.state !== 'Completed') throw new JevError(status, `Jev job did not complete: ${job.state}`);
      out = job.result;
    }
  }
  const answers = (out as { answers?: unknown } | null)?.answers;
  if (!answers || typeof answers !== 'object') {
    throw new JevError(status, `Jev response has no answers: ${raw.slice(0, 500)}`);
  }
  return out as JevResponse;
}

export interface JevClientOptions {
  provider: JevProvider;
  fetch: FetchLike;
  /** Waits between retries on 429/529. Injected so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

export async function callJev(req: JevRequest, opts: JevClientOptions): Promise<JevResponse> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? 4;
  const { url, headers, body } = jevHttpRequest(req, opts.provider);
  for (let attempt = 1; ; attempt++) {
    const res = await opts.fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return unwrapJevResponse(await res.text(), res.status);
    const errorBody = await res.text();
    const retryable = res.status === 429 || res.status === 529;
    if (!retryable || attempt >= maxAttempts) {
      throw new JevError(res.status, `Jev request failed (${res.status}): ${errorBody.slice(0, 300)}`);
    }
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1));
  }
}

export interface SortResult {
  ref: string;
  decision: SortDecision;
  model: string;
  inputTokens: number;
}

export async function sortEvent(
  event: CuratorEvent,
  ctx: SortContext,
  opts: JevClientOptions & { thresholds?: SortThresholds }
): Promise<SortResult> {
  const res = await callJev(buildJevRequest(event, ctx), opts);
  return {
    ref: event.ref,
    decision: interpretJevResponse(res, ctx, opts.thresholds),
    model: res.model,
    inputTokens: res.usage?.input_tokens ?? 0,
  };
}
