/**
 * Main-process terminal output is a BLOCKING write, and a stalled terminal can
 * freeze the whole app.
 *
 * In development the main process inherits the launching terminal, so
 * `process.stdout` / `process.stderr` are TTYs (`lsof -p <main> -d 1,2` shows
 * `/dev/ttysNNN`, not a pipe), and Node writes to a TTY synchronously on POSIX.
 * When the terminal stops draining -- flow control, a scrolled-back buffer, a
 * busy emulator -- one log line blocks the Electron main thread for as long as
 * the terminal takes to read it.
 *
 * Measured on 2026-08-27 (NIM-3959): a single `console.warn` from the slow-IPC
 * logger held the main thread for 12,638ms contiguously -- 85% of a 14.9s CPU
 * profile -- across a hang window that carried only 35KB of log output in
 * total. Volume was never the problem; the reader stalling was.
 *
 * It is also self-amplifying. The block pushes every in-flight IPC call past
 * the slow threshold, each of those logs a line, and each line blocks again.
 *
 * This guard bounds the exposure to one stalled write per cooldown. Nothing is
 * lost: the file transport is a separate electron-log transport that never goes
 * through here, so suppressed lines are still in `main.log`.
 *
 * Every terminal-bound writer shares ONE guard, because they share one TTY --
 * a stall observed on stderr means stdout is stalled too.
 */

export interface ConsoleStallGuardOptions {
  /** Emits the "we dropped lines" line. Also a terminal write, so it is timed too. */
  writeNotice: (text: string) => void;
  /** A single write at or above this many ms means the terminal is not draining. */
  stallThresholdMs?: number;
  /** How long to keep terminal output off after a stall. */
  cooldownMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

export interface ConsoleStallGuardStats {
  /** Lines dropped during the current cooldown. */
  suppressedWrites: number;
  /** How many times the terminal has stalled since start. */
  stallEvents: number;
  /** Duration of the most recent stall, in ms. */
  lastStallMs: number;
}

export interface ConsoleStallGuard {
  /** Runs `write` unless the terminal is known to be stalled. */
  run: (write: () => void) => void;
  stats: () => ConsoleStallGuardStats;
}

/**
 * 250ms is far above any healthy TTY write (microseconds) and far below the
 * multi-second stalls worth defending against, so it does not trip on an
 * ordinary busy moment.
 */
const DEFAULT_STALL_THRESHOLD_MS = 250;

/**
 * A terminal that stalled once is usually still stalled. Five seconds keeps a
 * cascade to a single blocking write without hiding output for long enough to
 * matter when reading along live.
 */
const DEFAULT_COOLDOWN_MS = 5000;

export function createConsoleStallGuard(options: ConsoleStallGuardOptions): ConsoleStallGuard {
  const { writeNotice } = options;
  const stallThresholdMs = options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = options.now ?? (() => performance.now());

  let suppressedUntil = 0;
  let suppressedWrites = 0;
  let stallEvents = 0;
  let lastStallMs = 0;

  /** Writes and reports how long the terminal took to accept it. */
  const timed = (write: () => void): number => {
    const started = now();
    write();
    return now() - started;
  };

  const enterCooldown = (durationMs: number): void => {
    lastStallMs = durationMs;
    stallEvents += 1;
    suppressedUntil = now() + cooldownMs;
  };

  return {
    run(write: () => void): void {
      if (now() < suppressedUntil) {
        suppressedWrites += 1;
        return;
      }

      // Leaving a cooldown: say what was dropped, because a silent gap in the
      // terminal is indistinguishable from the app having stopped doing work.
      if (suppressedWrites > 0) {
        const dropped = suppressedWrites;
        const stalledMs = Math.round(lastStallMs);
        suppressedWrites = 0;
        const noticeMs = timed(() => writeNotice(
          `[log] terminal stalled for ${stalledMs}ms; dropped ${dropped} console lines `
            + '(main.log is unaffected)',
        ));
        // The notice is itself a terminal write, so it can stall in turn.
        if (noticeMs >= stallThresholdMs) {
          enterCooldown(noticeMs);
          return;
        }
      }

      const elapsed = timed(write);
      if (elapsed >= stallThresholdMs) enterCooldown(elapsed);
    },

    stats: () => ({ suppressedWrites, stallEvents, lastStallMs }),
  };
}
