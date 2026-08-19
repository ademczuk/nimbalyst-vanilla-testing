import type { TeamMemberInfo } from '@nimbalyst/runtime/sync';

export function teamMemberDisplayName(
  member: Pick<TeamMemberInfo, 'userId' | 'name' | 'email'>,
): string {
  return member.name?.trim() || member.email || member.userId;
}
