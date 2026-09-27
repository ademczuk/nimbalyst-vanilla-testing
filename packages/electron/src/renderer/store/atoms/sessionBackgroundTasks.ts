import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

/** Mirrors `BackgroundTaskSummary` in the runtime's claudeCode/subagentDrain.ts. */
export interface BackgroundTaskSummary {
  taskId: string;
  description: string;
  taskType?: string;
  startedAt: number;
}

const NONE: BackgroundTaskSummary[] = [];

/**
 * Background tasks a session is waiting on after its lead turn ended (a
 * backgrounded shell or sub-agent the provider is draining). Live-only: the
 * provider publishes it through `sessions:session-updated` and clears it when
 * the drain ends, so it is never persisted or loaded with the session list.
 */
export const sessionBackgroundTasksAtom = atomFamily((_sessionId: string) =>
  atom<BackgroundTaskSummary[]>(NONE)
);

function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** One-line description, e.g. "Waiting on background task: Run the gates (12m)". */
export function describeBackgroundWait(tasks: BackgroundTaskSummary[], now: number): string {
  const label = (t: BackgroundTaskSummary) =>
    `${t.description || 'background task'} (${formatElapsed(now - t.startedAt)})`;
  if (tasks.length === 1) return `Waiting on background task: ${label(tasks[0])}`;
  return `Waiting on ${tasks.length} background tasks: ${tasks.map(label).join('; ')}`;
}
