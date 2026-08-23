/**
 * VENDORED SUBSET of
 * `packages/runtime/src/plugins/TrackerPlugin/models/trackerReadiness.ts`, with
 * the value normalizer mirrored from `trackerRelationships.ts`.
 *
 * The graph algorithm and accessor contract match the runtime. The only CLI
 * adaptation is schema lookup: direct mode registers the materialized models
 * read beside the tracker rows instead of loading the runtime global registry.
 *
 * KEEP IN SYNC with both runtime modules. Edge extraction, SCC handling, and
 * readiness semantics must change in the app and CLI together.
 */

import type { IssueKeyStatus } from '../cli/output.js';
import {
  getTrackerReadinessTypeModel,
  isTerminalStatus,
  resolveStatusCategory,
  type StatusCategory,
} from './trackerStatusCategory.js';

export const DEPENDENCY_BLOCKER_KEY = 'depends-on';
export const DEPENDENCY_BLOCKS_KEY = 'blocks';

export type ReadinessState = 'ready' | 'blocked' | 'closed';

export interface BlockerRef {
  itemId: string;
  ref: string;
  refStatus: IssueKeyStatus;
  title?: string;
  type: string;
  status: string;
  statusCategory: StatusCategory;
}

export interface Readiness {
  state: ReadinessState;
  blockedBy: BlockerRef[];
  unresolvedBlockerIds: string[];
  unblocks: number;
  inCycle: boolean;
  trackId: string;
}

export interface ReadinessReference {
  ref: string;
  refStatus: IssueKeyStatus;
}

export interface ReadinessAccessors<T> {
  getId: (item: T) => string;
  getType: (item: T) => string;
  getStatus: (item: T) => string;
  getTitle: (item: T) => string | undefined;
  getFieldValue: (item: T, fieldName: string) => unknown;
  getReference: (item: T) => ReadinessReference;
}

interface ReadinessNode<T> {
  item: T;
  id: string;
  type: string;
  status: string;
  terminal: boolean;
}

interface PreparedGraph<T> {
  nodesById: Map<string, ReadinessNode<T>>;
  blockerIdsByDependentId: Map<string, Set<string>>;
}

interface DependencyGraphAnalysis {
  /** SCCs of size greater than one, plus single items that depend on themselves. */
  cycles: string[][];
  trackIdByItemId: Map<string, string>;
}

interface RelationshipValue {
  itemId: string;
  relationshipTypeKey?: string;
}

function normalizeRelationshipValue(raw: unknown): RelationshipValue[] {
  const list: unknown[] = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const byId = new Map<string, RelationshipValue>();
  for (const entry of list) {
    let value: RelationshipValue | null = null;
    if (typeof entry === 'string') {
      value = entry ? { itemId: entry } : null;
    } else if (entry && typeof entry === 'object') {
      const object = entry as Record<string, unknown>;
      const itemId = typeof object.itemId === 'string'
        ? object.itemId
        : typeof object.id === 'string' ? object.id : '';
      if (itemId) {
        value = {
          itemId,
          ...(typeof object.relationshipTypeKey === 'string'
            ? { relationshipTypeKey: object.relationshipTypeKey }
            : {}),
        };
      }
    }
    if (value) byId.set(value.itemId, value);
  }
  return [...byId.values()];
}

function prepareGraph<T>(
  allItems: readonly T[],
  accessors: ReadinessAccessors<T>,
): PreparedGraph<T> {
  const nodesById = new Map<string, ReadinessNode<T>>();
  for (const item of allItems) {
    const id = accessors.getId(item);
    const type = accessors.getType(item);
    const status = accessors.getStatus(item);
    nodesById.set(id, {
      item,
      id,
      type,
      status,
      terminal: isTerminalStatus(type, status),
    });
  }

  const blockerIdsByDependentId = new Map<string, Set<string>>();
  const addEdge = (dependentId: string, blockerId: string): void => {
    let blockerIds = blockerIdsByDependentId.get(dependentId);
    if (!blockerIds) {
      blockerIds = new Set<string>();
      blockerIdsByDependentId.set(dependentId, blockerIds);
    }
    blockerIds.add(blockerId);
  };

  for (const node of nodesById.values()) {
    const fields = getTrackerReadinessTypeModel(node.type)?.fields ?? [];
    for (const field of fields) {
      if (field.type !== 'relationship' && field.type !== 'reference') continue;
      if (
        field.relationshipTypeKey !== DEPENDENCY_BLOCKER_KEY &&
        field.relationshipTypeKey !== DEPENDENCY_BLOCKS_KEY
      )
        continue;

      const relationships = normalizeRelationshipValue(
        accessors.getFieldValue(node.item, field.name),
      );
      for (const relationship of relationships) {
        const relationshipKey =
          relationship.relationshipTypeKey ?? field.relationshipTypeKey;
        if (relationshipKey === DEPENDENCY_BLOCKER_KEY) {
          addEdge(node.id, relationship.itemId);
        } else if (relationshipKey === DEPENDENCY_BLOCKS_KEY) {
          addEdge(relationship.itemId, node.id);
        }
      }
    }
  }

  return { nodesById, blockerIdsByDependentId };
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  constructor(ids: Iterable<string>) {
    for (const id of ids) this.parent.set(id, id);
  }

  /**
   * Two iterative passes rather than recursion. Union links the larger root
   * under the smaller one, with no rank or size heuristic, so a graph whose
   * merges arrive in descending-root order builds a parent chain as long as the
   * component -- and the first find on it would recurse that whole depth before
   * path compression ever runs.
   */
  find(id: string): string {
    let root = id;
    for (;;) {
      const parent = this.parent.get(root);
      if (!parent || parent === root) break;
      root = parent;
    }
    let current = id;
    while (current !== root) {
      const parent = this.parent.get(current)!;
      this.parent.set(current, root);
      current = parent;
    }
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [root, child] = leftRoot < rightRoot
      ? [leftRoot, rightRoot]
      : [rightRoot, leftRoot];
    this.parent.set(child, root);
  }
}

function analyzePreparedGraph<T>(prepared: PreparedGraph<T>): DependencyGraphAnalysis {
  const openIds = [...prepared.nodesById.values()]
    .filter((node) => !node.terminal)
    .map((node) => node.id)
    .sort();
  const openIdSet = new Set(openIds);
  const adjacency = new Map(openIds.map((id) => [id, [] as string[]]));
  // Tarjan condenses a self-edge into an SCC of size one, so it has to be
  // tracked separately or an item that depends on itself never reads as a cycle.
  const selfDependentIds = new Set<string>();
  const tracks = new DisjointSet(openIds);

  for (const dependentId of openIds) {
    const blockerIds = prepared.blockerIdsByDependentId.get(dependentId);
    if (!blockerIds) continue;
    for (const blockerId of [...blockerIds].sort()) {
      if (!openIdSet.has(blockerId)) continue;
      adjacency.get(dependentId)?.push(blockerId);
      if (blockerId === dependentId) selfDependentIds.add(dependentId);
      tracks.union(dependentId, blockerId);
    }
  }

  let nextIndex = 0;
  const indexById = new Map<string, number>();
  const lowLinkById = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const stronglyConnectedComponents: string[][] = [];

  /** Frame stack standing in for recursion; `edgeIndex` is the resume point. */
  const frames: { id: string; edgeIndex: number }[] = [];

  const discover = (id: string): void => {
    const index = nextIndex++;
    indexById.set(id, index);
    lowLinkById.set(id, index);
    stack.push(id);
    onStack.add(id);
    frames.push({ id, edgeIndex: 0 });
  };

  const strongConnect = (rootId: string): void => {
    discover(rootId);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const blockerIds = adjacency.get(frame.id) ?? [];

      if (frame.edgeIndex < blockerIds.length) {
        const blockerId = blockerIds[frame.edgeIndex++];
        if (!indexById.has(blockerId)) discover(blockerId);
        else if (onStack.has(blockerId)) {
          lowLinkById.set(
            frame.id,
            Math.min(lowLinkById.get(frame.id)!, indexById.get(blockerId)!),
          );
        }
        continue;
      }

      // Every edge consumed: this is the recursive version's return point.
      frames.pop();
      if (lowLinkById.get(frame.id) === indexById.get(frame.id)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.id);
        stronglyConnectedComponents.push(component.sort());
      }
      // The step iterative rewrites drop: the caller takes the callee's low
      // link, which recursion did on the line after the call. It has to run on
      // every return, including one that just closed an SCC.
      const caller = frames[frames.length - 1];
      if (caller) {
        lowLinkById.set(
          caller.id,
          Math.min(lowLinkById.get(caller.id)!, lowLinkById.get(frame.id)!),
        );
      }
    }
  };

  for (const id of openIds) {
    if (!indexById.has(id)) strongConnect(id);
  }

  const trackIdByRoot = new Map<string, string>();
  for (const id of openIds) {
    const root = tracks.find(id);
    const current = trackIdByRoot.get(root);
    if (!current || id < current) trackIdByRoot.set(root, id);
  }
  const trackIdByItemId = new Map<string, string>();
  for (const id of openIds) {
    trackIdByItemId.set(id, trackIdByRoot.get(tracks.find(id)) ?? id);
  }

  return {
    cycles: stronglyConnectedComponents.filter(
      (component) => component.length > 1 || selfDependentIds.has(component[0]),
    ),
    trackIdByItemId,
  };
}

function readinessState(terminal: boolean, openBlockerCount: number): ReadinessState {
  if (terminal) return 'closed';
  return openBlockerCount > 0 ? 'blocked' : 'ready';
}

/**
 * Compute readiness over the FULL unfiltered corpus. Filtering first turns
 * satisfied blockers into dangling ids and falsely marks dependents ready.
 */
export function computeReadinessForItems<T>(
  allItems: readonly T[],
  accessors: ReadinessAccessors<T>,
): Map<string, Readiness> {
  const prepared = prepareGraph(allItems, accessors);
  const analysis = analyzePreparedGraph(prepared);
  const cycleIds = new Set(analysis.cycles.flat());
  const openBlockerIdsByDependentId = new Map<string, string[]>();
  const unresolvedIdsByDependentId = new Map<string, string[]>();

  for (const node of prepared.nodesById.values()) {
    const openBlockerIds: string[] = [];
    const unresolvedIds: string[] = [];
    for (const blockerId of prepared.blockerIdsByDependentId.get(node.id) ?? []) {
      const blocker = prepared.nodesById.get(blockerId);
      if (!blocker) unresolvedIds.push(blockerId);
      else if (!blocker.terminal) openBlockerIds.push(blockerId);
    }
    openBlockerIdsByDependentId.set(node.id, openBlockerIds.sort());
    unresolvedIdsByDependentId.set(node.id, unresolvedIds.sort());
  }

  const unblocksByItemId = new Map<string, number>();
  for (const node of prepared.nodesById.values()) {
    if (node.terminal) continue;
    const blockers = openBlockerIdsByDependentId.get(node.id) ?? [];
    if (blockers.length !== 1) continue;
    const blockerId = blockers[0];
    // Closing an item cannot unblock itself; a self-dependency is a deadlock,
    // not leverage, and counting it would rank the item as though it freed work.
    if (blockerId === node.id) continue;
    unblocksByItemId.set(blockerId, (unblocksByItemId.get(blockerId) ?? 0) + 1);
  }

  const result = new Map<string, Readiness>();
  for (const node of prepared.nodesById.values()) {
    const openBlockerIds = openBlockerIdsByDependentId.get(node.id) ?? [];
    const blockedBy = openBlockerIds.map((blockerId): BlockerRef => {
      const blocker = prepared.nodesById.get(blockerId)!;
      const reference = accessors.getReference(blocker.item);
      const title = accessors.getTitle(blocker.item);
      return {
        itemId: blocker.id,
        ref: reference.ref,
        refStatus: reference.refStatus,
        ...(title ? { title } : {}),
        type: blocker.type,
        status: blocker.status,
        statusCategory: resolveStatusCategory(blocker.type, blocker.status),
      };
    });
    result.set(node.id, {
      state: readinessState(node.terminal, blockedBy.length),
      blockedBy,
      unresolvedBlockerIds: unresolvedIdsByDependentId.get(node.id) ?? [],
      unblocks: unblocksByItemId.get(node.id) ?? 0,
      inCycle: cycleIds.has(node.id),
      trackId: analysis.trackIdByItemId.get(node.id) ?? node.id,
    });
  }
  return result;
}
