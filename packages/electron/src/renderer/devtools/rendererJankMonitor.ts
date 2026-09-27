/**
 * Always-on renderer jank logging. Writes `[PERF] Renderer jank` to main.log so
 * typing lag and hitches can be diagnosed from logs instead of live probing.
 *
 * Three sources, flushed as one line at most every FLUSH_MS while jank exists:
 *   - long animation frames: blocked time plus the script that ran (the
 *     sourceURL names an extension bundle even in production)
 *   - slow input events (keydown/input/pointer): what the user felt
 *   - slow React commits (dev only): the components, their tab, and whether
 *     that tab is even visible
 */

import { setSlowCommitListener } from './renderProfiler';
import { summarizeSlowCommit, type SlowComponent } from './slowCommitReport';

const LONG_FRAME_MS = 200;
const SLOW_INPUT_MS = 150;
const FLUSH_MS = 10_000;
const MAX_COMMITS_PER_FLUSH = 5;

interface JankWindow {
  frames: number;
  blockedMs: number;
  maxFrameMs: number;
  scripts: Map<string, number>;
  inputs: number;
  maxInputMs: number;
  inputTarget: string | null;
  commits: { totalMs: number; top: SlowComponent[] }[];
  droppedCommits: number;
}

function emptyWindow(): JankWindow {
  return { frames: 0, blockedMs: 0, maxFrameMs: 0, scripts: new Map(), inputs: 0, maxInputMs: 0, inputTarget: null, commits: [], droppedCommits: 0 };
}

let current = emptyWindow();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function shortUrl(url: string): string {
  const path = url.split('?')[0];
  const parts = path.split('/');
  return parts.slice(-2).join('/') || 'inline';
}

function describeTarget(target: EventTarget | null): string | null {
  const el = target as Element | null;
  if (!el || typeof el.getAttribute !== 'function') return null;
  return el.getAttribute('data-testid') || el.getAttribute('class')?.trim().split(/\s+/)[0] || el.tagName.toLowerCase();
}

export function formatJankWindow(w: JankWindow, visibility: string, focused: boolean): string {
  const parts = [`visibility=${visibility}${focused ? '' : ' unfocused'}`];
  if (w.frames) {
    const scripts = [...w.scripts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, ms]) => `${k} ${Math.round(ms)}ms`).join('; ');
    parts.push(`longFrames=${w.frames} blocked=${Math.round(w.blockedMs)}ms max=${Math.round(w.maxFrameMs)}ms${scripts ? ` scripts=[${scripts}]` : ''}`);
  }
  if (w.inputs) parts.push(`slowInputs=${w.inputs} maxInput=${Math.round(w.maxInputMs)}ms target=${w.inputTarget ?? '?'}`);
  for (const c of w.commits) {
    const top = c.top.slice(0, 3).map(t =>
      `${t.name}${t.instances > 1 ? `x${t.instances}` : ''} ${t.selfMs}ms${t.element ? ` .${t.element}` : ''}${t.visible === false ? ' HIDDEN' : ''}${t.context ? ` in ${t.context}` : ''}`
    ).join(', ');
    parts.push(`commit ${c.totalMs}ms: ${top}`);
  }
  if (w.droppedCommits) parts.push(`+${w.droppedCommits} more slow commits`);
  return parts.join(' | ');
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const w = current;
    current = emptyWindow();
    if (!w.frames && !w.inputs && !w.commits.length) return;
    const line = formatJankWindow(w, document.visibilityState, document.hasFocus());
    try {
      window.electronAPI?.send('perf:renderer-jank', line);
    } catch {
      // Logging must never throw into the app.
    }
  }, FLUSH_MS);
}

function observe(type: string, callback: (entries: any[]) => void, extra: Record<string, unknown> = {}): void {
  if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
  try {
    new PerformanceObserver(list => callback(list.getEntries())).observe({ type, buffered: false, ...extra } as PerformanceObserverInit);
  } catch {
    // Unsupported options on this Chromium; skip that source.
  }
}

export function installRendererJankMonitor(): void {
  if (installed || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  installed = true;

  observe('long-animation-frame', entries => {
    for (const e of entries) {
      if (e.duration < LONG_FRAME_MS) continue;
      current.frames++;
      current.blockedMs += e.blockingDuration ?? e.duration;
      current.maxFrameMs = Math.max(current.maxFrameMs, e.duration);
      for (const s of e.scripts ?? []) {
        if (s.duration < 20) continue;
        const key = `${s.sourceFunctionName || s.invoker || '?'}@${shortUrl(s.sourceURL || '')}`;
        current.scripts.set(key, (current.scripts.get(key) ?? 0) + s.duration);
      }
      scheduleFlush();
    }
  });

  observe('event', entries => {
    for (const e of entries) {
      if (e.duration < SLOW_INPUT_MS) continue;
      current.inputs++;
      if (e.duration > current.maxInputMs) {
        current.maxInputMs = e.duration;
        current.inputTarget = `${e.name}:${describeTarget(e.target)}`;
      }
      scheduleFlush();
    }
  }, { durationThreshold: SLOW_INPUT_MS });

  setSlowCommitListener((rootFiber, floor) => {
    if (current.commits.length >= MAX_COMMITS_PER_FLUSH) {
      current.droppedCommits++;
      return;
    }
    current.commits.push(summarizeSlowCommit(rootFiber, floor));
    scheduleFlush();
  });
}
