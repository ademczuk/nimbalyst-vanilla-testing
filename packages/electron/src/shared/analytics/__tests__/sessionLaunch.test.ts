// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  SESSION_LAUNCH_SOURCES,
  bucketSessionOrdinal,
  initiatorForLaunchSource,
  toSessionLaunchSource,
  validateSessionLaunchEvent,
} from '../sessionLaunch';

describe('session launch contract', () => {
  it('derives an initiator for every launch source, defaulting to app rather than user', () => {
    // The whole point of the field is to deflate a funnel number that counts
    // app-created sessions as user attempts. A source added later without a
    // mapping must not silently land in `user`.
    for (const source of SESSION_LAUNCH_SOURCES) {
      expect(initiatorForLaunchSource(source)).toMatch(/^(user|app|agent)$/);
    }
    expect(initiatorForLaunchSource('unknown')).toBe('app');
    expect(initiatorForLaunchSource('app_startup')).toBe('app');
    expect(initiatorForLaunchSource('meta_agent')).toBe('agent');
    expect(initiatorForLaunchSource('new_session_button')).toBe('user');
  });

  it('narrows an unrecognised or hostile IPC value to unknown', () => {
    expect(toSessionLaunchSource('worktree')).toBe('worktree');
    expect(toSessionLaunchSource('not_a_real_source')).toBe('unknown');
    expect(toSessionLaunchSource(undefined)).toBe('unknown');
    expect(toSessionLaunchSource('/Users/greg/secret')).toBe('unknown');
  });

  it('buckets the session ordinal so session one stays its own population', () => {
    expect(bucketSessionOrdinal(0)).toBe('1');
    expect(bucketSessionOrdinal(1)).toBe('1');
    expect(bucketSessionOrdinal(2)).toBe('2-4');
    expect(bucketSessionOrdinal(9)).toBe('5-9');
    expect(bucketSessionOrdinal(500)).toBe('10+');
  });

  it('rejects an out-of-enum source and a path-shaped value', () => {
    expect(() =>
      validateSessionLaunchEvent('create_ai_session', {
        launchSource: 'from_the_new_thing' as never,
      }),
    ).toThrow(/not an allowlisted category/);

    expect(() =>
      validateSessionLaunchEvent('create_ai_session', {
        sessionOrdinalBucket: '/Users/greg/projects',
      }),
    ).toThrow(/forbidden identifying value/);

    expect(() =>
      validateSessionLaunchEvent('create_ai_session', {
        somethingNobodyDeclared: true,
      } as never),
    ).toThrow(/not an allowlisted property/);
  });

  it('accepts the full shape the emitter builds', () => {
    const { properties } = validateSessionLaunchEvent('create_ai_session', {
      provider: 'claude-code',
      is_worktree_session: false,
      is_workstream_child: false,
      is_meta_agent_session: false,
      launchSource: 'launch_popup',
      initiator: 'user',
      isFirstEverSession: true,
      sessionOrdinalBucket: '1',
      hadPrefilledPrompt: false,
    });
    expect(properties.initiator).toBe('user');
  });
});
