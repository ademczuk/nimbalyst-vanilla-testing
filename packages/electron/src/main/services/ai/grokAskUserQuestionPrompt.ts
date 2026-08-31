/**
 * Bridges Grok's native question tool onto Nimbalyst's durable AskUserQuestion
 * prompt.
 *
 * Grok ships its own `ask_user_question` tool. On the old one-shot `grok -p`
 * transport it answered itself ("No user is available to answer questions in
 * this non-interactive session"), so no widget could ever appear. Over
 * `grok agent stdio` it instead sends the answerable xAI extension request
 * `_x.ai/ask_user_question` and keeps the tool — and the turn — blocked until
 * the client responds.
 *
 * This module is that response. It reuses the existing prompt path rather than
 * adding a Grok-specific one:
 *
 *   - the widget is the ordinary `AskUserQuestionWidget`, rendered from a
 *     `nimbalyst_tool_use` row keyed by Grok's own `toolCallId`;
 *   - the answer arrives on the same IPC channel every other AskUserQuestion
 *     uses (`ask-user-question-response:<sessionId>:<questionId>`), emitted by
 *     AIService's `claude-code:answer-question` / cancel handlers;
 *   - the durable fallback is the same `ask_user_question_response` row poll.
 *
 * Routing: the handler is a single application-wide static on
 * `GrokBuildProvider`, but questions arrive per session. Every id here is
 * scoped by `request.nimbalystSessionId` (supplied by `GrokACPProtocol` from
 * the active turn), never by "the current session" — two concurrent Grok
 * sessions each get their question in their own transcript.
 *
 * Settling: the promise returned to Grok MUST settle, or the agent process sits
 * on an unanswered ACP request forever. Four paths settle it — answer, cancel,
 * turn abort, and a backstop deadline — and each writes the terminal
 * `nimbalyst_tool_result` so the widget never keeps offering buttons whose
 * answer has nowhere to go.
 */

import type {
  GrokAskUserQuestionRequest,
  GrokAskUserQuestionResponse,
} from '@nimbalyst/runtime/ai/server/protocols/GrokACPProtocol';

/** Multi-select answers are joined by the widget with this exact separator. */
const MULTI_SELECT_SEPARATOR = ', ';

const POLL_INTERVAL_MS = 1000;

/**
 * Backstop only. Nothing about a question expires — the real settle paths are
 * the user's answer and the turn's abort. But an unanswered request pins a live
 * Grok process, so refuse to hold one indefinitely.
 */
const MAX_WAIT_MS = 30 * 60 * 1000;

/** Widget-shaped question, matching `AskUserQuestionWidget.parseQuestions`. */
export interface WidgetQuestion {
  header: string;
  question: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

/**
 * Grok sends no `header` (the widget requires one) and may send `multiSelect:
 * null`. Questions with no options can't render as a multiple-choice card, so
 * they are dropped here rather than reaching the widget's own defensive filter.
 */
export function toWidgetQuestions(
  request: Pick<GrokAskUserQuestionRequest, 'questions'>,
): WidgetQuestion[] {
  const questions = Array.isArray(request.questions) ? request.questions : [];
  const usable = questions.filter(
    (q) => q && typeof q.question === 'string' && q.question.length > 0
      && Array.isArray(q.options) && q.options.length > 0,
  );

  return usable.map((q, index) => ({
    header: usable.length > 1 ? `Question ${index + 1}` : 'Question',
    question: q.question,
    options: (q.options ?? [])
      .filter((o): o is { label: string; description?: string } =>
        !!o && typeof o.label === 'string' && o.label.length > 0)
      .map((o) => ({
        label: o.label,
        description: typeof o.description === 'string' ? o.description : '',
      })),
    multiSelect: q.multiSelect === true,
  })).filter((q) => q.options.length > 0);
}

/**
 * Widget answers -> the xAI response schema: keyed by question TEXT (not index
 * or id), and an array for a multi-select question. The widget joins a
 * multi-select answer with ", ", so split on the same separator it wrote.
 */
export function toGrokAnswers(
  questions: WidgetQuestion[],
  answers: Record<string, string> | undefined,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const question of questions) {
    const answer = answers?.[question.question];
    if (typeof answer !== 'string' || answer.length === 0) continue;
    result[question.question] = question.multiSelect
      ? answer.split(MULTI_SELECT_SEPARATOR).map((part) => part.trim()).filter(Boolean)
      : answer;
  }
  return result;
}

/**
 * Everything this presenter touches outside itself. Injected rather than
 * imported so the prompt logic can be exercised without the Electron main
 * process — and so this module never drags the runtime barrel into its graph.
 */
export interface GrokAskUserQuestionRuntime {
  persistToolUse: (args: {
    sessionId: string;
    toolUseId: string;
    toolName: string;
    input: unknown;
    source?: string;
  }) => Promise<void>;
  persistToolResult: (args: {
    sessionId: string;
    toolUseId: string;
    result: unknown;
    isError?: boolean;
    source?: string;
  }) => Promise<void>;
  listRecentMessages: (sessionId: string, limit: number) => Promise<Array<{ content: string }>>;
  subscribe: (channel: string, listener: (event: unknown, payload: any) => void) => () => void;
  setPendingPrompt: (sessionId: string, pending: boolean) => void;
  onSettled: (sessionId: string, questionId: string) => void;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

const CANCELLED: GrokAskUserQuestionResponse = {
  outcome: 'cancelled',
  answers: {},
  partial_answers: false,
};

/**
 * Present one Grok question and block until it is answered, cancelled, aborted,
 * or the backstop deadline passes.
 */
export async function presentGrokAskUserQuestion(
  request: GrokAskUserQuestionRequest,
  runtime: GrokAskUserQuestionRuntime,
): Promise<GrokAskUserQuestionResponse> {
  const sessionId = request.nimbalystSessionId;

  // Deliberately NOT Grok's bare `toolCallId`. Grok also streams a
  // `session/update` tool_call for its own question tool under that id; if the
  // agent's row lands first, the parser's provider-tool-call dedup would drop
  // this prompt row and no widget would ever render. A derived id cannot
  // collide, so the widget renders whether or not the mapper suppressed the
  // agent's copy.
  const questionId = request.toolCallId ? `${request.toolCallId}-question` : '';

  // No host session means no transcript to render into (headless, or the turn
  // already ended). A1's no-handler default is the same answer.
  if (!sessionId || !questionId) return CANCELLED;

  const questions = toWidgetQuestions(request);
  if (questions.length === 0) return CANCELLED;

  await runtime.persistToolUse({
    sessionId,
    toolUseId: questionId,
    toolName: 'AskUserQuestion',
    input: { questions },
    source: 'grok-build',
  });
  runtime.setPendingPrompt(sessionId, true);

  const channel = `ask-user-question-response:${sessionId}:${questionId}`;
  const pollIntervalMs = runtime.pollIntervalMs ?? POLL_INTERVAL_MS;
  const maxWaitMs = runtime.maxWaitMs ?? MAX_WAIT_MS;

  // Terminal cleanup goes in `finally`, not on the happy path. `subscribe` and
  // `persistToolResult` are injected dependencies that can reject, and if one
  // does, a return-path cleanup is skipped: the session stays flagged as
  // waiting on a prompt while Grok sits on an ACP request nothing will ever
  // answer -- a hung agent process for what is only a failed write.
  try {
    const answered = await new Promise<{
      answers?: Record<string, string>;
      cancelled: boolean;
    }>((resolve) => {
      let settled = false;
      let unsubscribe: (() => void) | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let deadline: ReturnType<typeof setTimeout> | null = null;
      let onAbort: (() => void) | null = null;

      const settle = (result: { answers?: Record<string, string>; cancelled: boolean }) => {
        if (settled) return;
        settled = true;
        unsubscribe?.();
        if (pollTimer) clearInterval(pollTimer);
        if (deadline) clearTimeout(deadline);
        if (onAbort) request.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

      unsubscribe = runtime.subscribe(channel, (_event, payload) => {
        settle({
          answers: payload?.answers as Record<string, string> | undefined,
          cancelled: payload?.cancelled === true,
        });
      });

      // The turn going away is not an answer, but it must still release Grok.
      if (request.signal) {
        if (request.signal.aborted) {
          settle({ cancelled: true });
          return;
        }
        onAbort = () => settle({ cancelled: true });
        request.signal.addEventListener('abort', onAbort, { once: true });
      }

      // Durable fallback: mobile answers and any dropped IPC land as a row.
      pollTimer = setInterval(() => {
        void runtime.listRecentMessages(sessionId, 50).then((messages) => {
          if (settled) return;
          for (const message of messages) {
            let content: any;
            try {
              content = JSON.parse(message.content);
            } catch {
              continue;
            }
            if (content?.type !== 'ask_user_question_response') continue;
            if (content.questionId !== questionId && content.rawQuestionId !== questionId) continue;
            settle({
              answers: content.answers as Record<string, string> | undefined,
              cancelled: content.cancelled === true,
            });
            return;
          }
        }).catch(() => {
          // Transient database error -- the next tick tries again.
        });
      }, pollIntervalMs);

      deadline = setTimeout(() => settle({ cancelled: true }), maxWaitMs);
    });

    const grokAnswers = answered.cancelled
      ? {}
      : toGrokAnswers(questions, answered.answers);
    const cancelled = answered.cancelled || Object.keys(grokAnswers).length === 0;

    await runtime.persistToolResult({
      sessionId,
      toolUseId: questionId,
      result: {
        answers: cancelled ? {} : (answered.answers ?? {}),
        cancelled,
        respondedAt: Date.now(),
      },
      isError: cancelled,
      source: 'grok-build',
    });

    if (cancelled) return CANCELLED;

    return {
      outcome: 'accepted',
      answers: grokAnswers,
      // Every rendered question is required by the widget's own submit guard,
      // so an accepted answer is always complete.
      partial_answers: false,
    };
  } finally {
    runtime.setPendingPrompt(sessionId, false);
    runtime.onSettled(sessionId, questionId);
  }
}

/**
 * A question that reaches no UI settles cancelled, which is exactly A1's
 * no-handler default. Exported so the wiring layer answers identically.
 */
export const GROK_QUESTION_CANCELLED = CANCELLED;
