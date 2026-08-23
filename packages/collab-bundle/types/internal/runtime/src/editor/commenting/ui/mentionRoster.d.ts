import type { CommentMember } from '../types';
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
export declare function useMentionRoster(getMembers: () => CommentMember[], queryString: string | null): CommentMember[];
/**
 * Match a mention query against both the display name and the email.
 *
 * People know each other by whichever of the two they saw first, and the
 * roster can carry a real name for someone whose address is what everyone
 * actually recognizes -- searching only `name` makes that member unreachable.
 */
export declare function filterMentionCandidates(members: CommentMember[], query: string | null): CommentMember[];
/**
 * Drop mentions for users the roster no longer offers.
 *
 * The picker only ever offers roster members, but a composer can stay open
 * across a roster change (someone leaves the org mid-draft). Submitting a
 * mention for a non-member is rejected downstream by `validateCommentMentions`
 * with `MENTION_FORBIDDEN`, which would fail the whole comment; dropping the
 * mention here posts the comment and simply does not notify a user we are no
 * longer allowed to notify.
 */
export declare function retainMentionableUserIds(mentionedUserIds: string[], members: CommentMember[]): string[];
