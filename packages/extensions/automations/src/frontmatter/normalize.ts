/**
 * Normalize and validate automationStatus frontmatter.
 *
 * Frontmatter is hand-editable, so YAML can hand us any shape at all. Every
 * consumer of an `AutomationStatus` — the scheduler, the document header, the
 * MCP tools — assumes the declared types hold. Normalizing once here is what
 * makes that assumption true, instead of each call site guarding separately.
 *
 * See nimbalyst#1374: a scalar `days: mon` passed a `length === 0` check as a
 * 3-character string and then threw on `.map`, which killed the scheduler and
 * stopped the automation from running for weeks.
 */

import type { AutomationSchedule, AutomationStatus, DayOfWeek } from './types';

const VALID_DAYS: readonly string[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface NormalizedAutomation {
  status: AutomationStatus;
  /**
   * The stored schedule was coercible but not in canonical form, so the file
   * should be rewritten. Only ever true when `problem` is null — we never
   * write back a schedule we had to invent values for.
   */
  changed: boolean;
  /** Set when the schedule cannot fire and needs a human edit. */
  problem: string | null;
}

/** Render an offending value compactly for an error message. */
function describeValue(value: unknown): string {
  if (value === undefined) return 'nothing';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Coerce a `days` value into a list of valid day names.
 *
 * Accepts a sequence (`[mon, tue]`), a scalar (`mon`), and a comma-separated
 * scalar (`"mon,tue"`) — the three forms that have actually shown up in the
 * wild. Anything unrecognized is dropped rather than passed through, so the
 * result is always a `DayOfWeek[]`.
 */
function normalizeDays(raw: unknown): DayOfWeek[] {
  const candidates: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];

  const days = new Set<DayOfWeek>();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const day = candidate.trim().toLowerCase();
    if (VALID_DAYS.includes(day)) days.add(day as DayOfWeek);
  }
  return [...days];
}

/**
 * Coerce a time value to zero-padded "HH:MM", or null if it isn't a time.
 * `6:00` is accepted because it already worked before this validation existed.
 */
function normalizeTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Best-effort normalization: always returns a structurally valid schedule so no
 * consumer can trip over the raw value, plus a `problem` describing why it can
 * never fire. A schedule with a problem is displayed but never scheduled.
 */
function normalizeSchedule(raw: unknown): { schedule: AutomationSchedule; problem: string | null } {
  if (!raw || typeof raw !== 'object') {
    return {
      schedule: { type: 'weekly', days: [], time: '00:00' },
      problem: `schedule is missing (got ${describeValue(raw)})`,
    };
  }

  const source = raw as Record<string, unknown>;

  switch (source.type) {
    case 'interval': {
      const intervalMinutes = Number(source.intervalMinutes);
      if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
        return {
          schedule: { type: 'interval', intervalMinutes: 0 },
          problem: `intervalMinutes must be a positive number (got ${describeValue(source.intervalMinutes)})`,
        };
      }
      return { schedule: { type: 'interval', intervalMinutes }, problem: null };
    }

    case 'daily': {
      const time = normalizeTime(source.time);
      if (!time) {
        return {
          schedule: { type: 'daily', time: '00:00' },
          problem: `time must be "HH:MM" (got ${describeValue(source.time)})`,
        };
      }
      return { schedule: { type: 'daily', time }, problem: null };
    }

    case 'weekly': {
      const days = normalizeDays(source.days);
      const time = normalizeTime(source.time);

      const problems: string[] = [];
      if (days.length === 0) {
        problems.push(
          `days must list one or more of ${VALID_DAYS.join(', ')} (got ${describeValue(source.days)})`,
        );
      }
      if (!time) problems.push(`time must be "HH:MM" (got ${describeValue(source.time)})`);

      return {
        schedule: { type: 'weekly', days, time: time ?? '00:00' },
        problem: problems.length > 0 ? problems.join('; ') : null,
      };
    }

    default:
      // An unrecognized type is inert everywhere (every switch on it falls
      // through to a null/undefined result), so pass it along untouched and
      // just report it.
      return {
        schedule: source as unknown as AutomationSchedule,
        problem: `unknown schedule type ${describeValue(source.type)}`,
      };
  }
}

/** Field-wise comparison, so a key-order difference never looks like a change. */
function scheduleMatches(normalized: AutomationSchedule, raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const source = raw as Record<string, unknown>;
  if (source.type !== normalized.type) return false;

  switch (normalized.type) {
    case 'interval':
      return source.intervalMinutes === normalized.intervalMinutes;
    case 'daily':
      return source.time === normalized.time;
    case 'weekly': {
      const days = source.days;
      return (
        source.time === normalized.time &&
        Array.isArray(days) &&
        days.length === normalized.days.length &&
        normalized.days.every((day, i) => days[i] === day)
      );
    }
  }
}

/**
 * Normalize a raw `automationStatus` object from YAML. Returns null only when
 * there is nothing object-shaped to work with.
 */
export function normalizeAutomationStatus(raw: unknown): NormalizedAutomation | null {
  if (!raw || typeof raw !== 'object') return null;

  const status = raw as AutomationStatus;
  const { schedule, problem } = normalizeSchedule((status as { schedule?: unknown }).schedule);

  return {
    status: { ...status, schedule },
    changed: problem === null && !scheduleMatches(schedule, (status as { schedule?: unknown }).schedule),
    problem,
  };
}
