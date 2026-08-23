/**
 * How a readiness verdict is projected to a caller who cannot see every blocker.
 *
 * Readiness is computed over the FULL unfiltered corpus and must stay that way
 * -- deriving it after a caller's filters have run turns satisfied blockers into
 * dangling ids and reports blocked work as ready. But the explanation that
 * leaves the computation is a different question from the computation itself: a
 * caller asking for bugs should not be handed the title and private reference of
 * an archived plan it filtered out, and on the tool surface a blocker title is
 * attacker-influenced free text landing in an agent's context.
 *
 * So the verdict survives intact and the identifying detail does not. Both the
 * MCP projection and the grid chip call `projectBlockedBy`, because two copies
 * of this rule is how the surfaces come to disagree about what is safe to show.
 */

import type { BlockerRef } from './trackerReadiness';
import type { StatusCategory } from './trackerStatusCategory';

/**
 * The part of a caller's query that partitions the corpus rather than selects
 * within it.
 *
 * Type and archive scope carve the tracker into disjoint sets the caller chose
 * not to look at. `search` / `status` / `priority` / `where` narrow within a set
 * the caller is already looking at, and are deliberately absent: redacting on
 * those would strip almost every blocker of the explanation it exists to give,
 * since a blocker rarely matches the same search text as its dependent.
 *
 * An empty scope spans everything, so nothing is redacted -- the right default
 * for a caller that never narrowed.
 */
export interface BlockerVisibilityScope {
  /** The single tracker type the caller scoped to; omit when it spans types. */
  type?: string;
  /**
   * Corpus ids the caller's other scoping filters exclude. Each surface builds
   * this from its own vocabulary -- the grid's archive toggle, the tool's
   * `archived` argument and workspace scope -- because those filters have no
   * common spelling; what they must not do is disagree about the consequence,
   * which is what lives below.
   */
  excludedItemIds?: ReadonlySet<string>;
}

/**
 * A blocker the caller's own scope excluded.
 *
 * What survives is the verdict and the part of it the caller can act on without
 * seeing the item: it is counted, so work never appears unready with no reason,
 * and it carries its lifecycle state, so "waiting on something in progress" and
 * "waiting on something nobody has started" stay distinguishable.
 *
 * What does not survive is identity. `title` is free text belonging to an item
 * the caller did not ask for. `ref` is worse: for an unshared item it is this
 * machine's private dotted number, which resolves to nothing -- or to a
 * different item -- for any other reader.
 *
 * `itemId` stays. It is opaque, it is already the universal handle in this API,
 * and keeping it means the caller can widen its own filters and fetch the item
 * deliberately. That second call is a scope decision the caller makes, which is
 * exactly the thing the accidental disclosure was not.
 */
export interface RedactedBlockerRef {
  itemId: string;
  type: string;
  status: string;
  statusCategory: StatusCategory;
  /** Always true, and absent on a blocker the caller could have seen anyway. */
  outOfScope: true;
}

export interface VisibleBlockerRef extends BlockerRef {
  outOfScope?: false;
}

export type ProjectedBlockerRef = VisibleBlockerRef | RedactedBlockerRef;

export function isOutOfScopeBlocker(
  blocker: ProjectedBlockerRef,
): blocker is RedactedBlockerRef {
  return blocker.outOfScope === true;
}

/** Whether the caller's own scope would have returned this blocker. */
export function isBlockerInScope(
  blocker: BlockerRef,
  scope: BlockerVisibilityScope,
): boolean {
  if (scope.type !== undefined && blocker.type !== scope.type) return false;
  return !scope.excludedItemIds?.has(blocker.itemId);
}

/** Redact the blockers this caller's scope excluded; keep the rest verbatim. */
export function projectBlockedBy(
  blockedBy: readonly BlockerRef[],
  scope: BlockerVisibilityScope,
): ProjectedBlockerRef[] {
  return blockedBy.map((blocker): ProjectedBlockerRef => (
    isBlockerInScope(blocker, scope)
      ? blocker
      : {
        itemId: blocker.itemId,
        type: blocker.type,
        status: blocker.status,
        statusCategory: blocker.statusCategory,
        outOfScope: true,
      }
  ));
}

/**
 * What to tell a reader about declared dependencies that resolve to nothing.
 *
 * A dangling target is far more likely to be a deletion than a real blocker, so
 * it must not block -- but swallowing it makes a broken dependency link
 * invisible forever, which is why every surface says the same sentence about it
 * instead of each inventing its own or omitting it.
 */
export function describeUnresolvedBlockers(count: number): string {
  if (count <= 0) return '';
  return count === 1
    ? '1 declared dependency is no longer in this workspace. It does not block, and the link can be removed.'
    : `${count} declared dependencies are no longer in this workspace. They do not block, and the links can be removed.`;
}
