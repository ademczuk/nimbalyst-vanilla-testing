// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { teamMemberDisplayName } from '../teamMemberDisplayName';

describe('teamMemberDisplayName', () => {
  it('prefers a non-blank name, then email, then member id', () => {
    expect(teamMemberDisplayName({
      userId: 'member-named',
      name: '  Ada Lovelace  ',
      email: 'ada@example.com',
    })).toBe('Ada Lovelace');
    expect(teamMemberDisplayName({
      userId: 'member-emailed',
      email: 'grace@example.com',
    })).toBe('grace@example.com');
    expect(teamMemberDisplayName({
      userId: 'member-id-only',
      email: null,
    })).toBe('member-id-only');
    expect(teamMemberDisplayName({
      userId: 'member-blank-name',
      name: '   ',
      email: 'linus@example.com',
    })).toBe('linus@example.com');
  });
});
