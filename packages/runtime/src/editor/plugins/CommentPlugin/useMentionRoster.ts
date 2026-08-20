import { useEffect, useState } from 'react';
import type { CommentMember } from '../../commenting/types';

/**
 * Keep the `@`-mention roster current for an open composer.
 *
 * The host's `getMembers` is a live read of team sync state, which hydrates
 * asynchronously. A composer that mounts before the roster lands would freeze
 * an empty snapshot for its whole lifetime, so every `@` reported "No matches
 * found" until the composer was closed and reopened.
 *
 * Re-reads while a mention query is open (`queryString` non-null) and returns
 * the PREVIOUS array whenever the roster is unchanged, so callers can keep
 * memoizing typeahead options on this value without the list re-identifying on
 * every keystroke. That referential stability is why the original code froze
 * the roster; it is preserved here without the staleness.
 */
export function useMentionRoster(
  getMembers: () => CommentMember[],
  queryString: string | null,
): CommentMember[] {
  const [members, setMembers] = useState<CommentMember[]>(() => getMembers());

  useEffect(() => {
    if (queryString === null) return;
    setMembers((previous) => {
      const next = getMembers();
      const unchanged = previous.length === next.length
        && previous.every((member, index) =>
          member.userId === next[index].userId
          && member.name === next[index].name
          && member.email === next[index].email);
      return unchanged ? previous : next;
    });
  }, [queryString, getMembers]);

  return members;
}

/**
 * Match a mention query against both the display name and the email.
 *
 * People know each other by whichever of the two they saw first, and the
 * roster can carry a real name for someone whose address is what everyone
 * actually recognizes -- searching only `name` makes that member unreachable.
 */
export function filterMentionCandidates(
  members: CommentMember[],
  query: string | null,
): CommentMember[] {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return members;
  return members.filter((member) =>
    member.name.toLowerCase().includes(q)
    || (member.email ?? '').toLowerCase().includes(q));
}
