/**
 * Live data behind tracker references in a host that has a `TrackerDataSource`
 * but no desktop tracker atoms -- the web console.
 *
 * A `TrackerReferenceNode` stores only a key. Desktop resolves it through the
 * runtime Jotai store; a browser host has the data source instead, so this
 * builds the same answers from its snapshot and change stream.
 *
 * Shaped for `useSyncExternalStore`: one `subscribe`, and every read returns the
 * SAME object until something it depends on changes. A chip for KB-12 must not
 * re-render because KB-40 was edited, and a document can hold dozens of chips.
 * Reads are recomputed lazily against a version counter and then compared by
 * item identity -- the data source replaces only the items that changed, so an
 * unchanged item keeps its object and the previous result is handed back.
 *
 * Deliberately free of the tracker-ui barrels: the collab bundle's editor entry
 * imports this, and it must not drag the grid or list surfaces into that graph.
 */

import {
  globalRegistry,
  type FieldDefinition,
  type FieldOption,
  type PredicateDefinition,
  type StatusCategory,
  type TrackerDataModel,
} from '@nimbalyst/tracker-schema';
import {
  isRelationshipField,
  normalizeRelationshipValue,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerRelationships';

import type {
  TrackerDataChange,
  TrackerDataSource,
  TrackerItem,
} from '../../trackers/dataSource';
import {
  collectCandidateTypes,
  searchTrackerReferenceCandidates,
  type TrackerReferenceCandidate,
  type TrackerReferenceSearchResult,
} from '@nimbalyst/runtime/plugins/TrackerLinkPlugin/trackerReferenceSearch';
import { readStoredFieldValue } from '../../trackers/relationshipFieldStorage';
import type { TrackerReferenceStatusOption } from './trackerReferenceLifecycle';

export type { TrackerReferenceStatusOption } from './trackerReferenceLifecycle';
export type { TrackerReferenceSearchResult } from '@nimbalyst/runtime/plugins/TrackerLinkPlugin/trackerReferenceSearch';

export interface TrackerReferenceActor {
  email: string;
  name?: string;
}

export interface TrackerReferenceTypeInfo {
  type: string;
  displayName: string;
  /** CSS color from the schema, or a neutral token when the type is unknown. */
  color: string;
  /** Material Symbols ligature name; empty when the type is unknown. */
  icon: string;
}

export interface TrackerReferenceStatusInfo {
  value: string;
  label: string;
  /** CSS color: the option's own color, else one derived from its category. */
  color: string;
  category?: StatusCategory;
}

export type TrackerReferenceResolution =
  /** The data source has not delivered a synced snapshot yet; absence means nothing. */
  | { state: 'loading'; key: string }
  /** Synced, and no item carries this key or id. */
  | { state: 'missing'; key: string }
  | {
      state: 'resolved';
      key: string;
      item: TrackerItem;
      typeInfo: TrackerReferenceTypeInfo;
      status: TrackerReferenceStatusInfo | null;
    };

export interface TrackerStatement {
  claim: TrackerItem;
  predicateId: string | null;
  /** Item id the claim's `object` relationship points at, when the object is an entity. */
  objectItemId: string | null;
  valueText: string | null;
  basis: string | null;
  basisLabel: string | null;
  applicability: string | null;
  citationCount: number;
  status: TrackerReferenceStatusInfo | null;
}

export interface TrackerStatementGroup {
  predicateId: string | null;
  /** Registry label, else the raw predicate id, else "Unspecified". */
  label: string;
  statements: TrackerStatement[];
}

export interface TrackerBacklink {
  source: TrackerItem;
  /** Relationship field on `source` that targets the item. */
  fieldName: string;
  relationshipTypeKey?: string;
}

/** The slice of the schema registry this module reads; injectable for tests. */
export interface TrackerReferenceSchema {
  get(type: string): TrackerDataModel | undefined;
  getPredicate(id: string): PredicateDefinition | undefined;
  onChange(listener: () => void): () => void;
}

export interface TrackerReferenceResolver {
  subscribe(listener: () => void): () => void;
  /** Resolve an issue key (`KB-12`) or a record id. Stable until the item changes. */
  resolve(key: string): TrackerReferenceResolution;
  /** Claims whose `subject` targets the item, grouped by predicate. Stable. */
  statementsAbout(itemId: string): readonly TrackerStatementGroup[];
  /** Items with any relationship field targeting the item. Stable. */
  backlinks(itemId: string): readonly TrackerBacklink[];
  typeInfo(type: string): TrackerReferenceTypeInfo;
  statusInfo(item: TrackerItem): TrackerReferenceStatusInfo | null;
  /** Field value tolerant of both storage shapes (nested `customFields` wins). */
  fieldValue(item: TrackerItem, fieldName: string): unknown;
  /** Display label for a select option, falling back to the raw value. */
  optionLabel(type: string, fieldName: string, value: string): string;
  /** Item ids a relationship field on `item` targets, in stored order. */
  relationshipTargets(item: TrackerItem, fieldName: string): string[];
  predicateLabel(predicateId: string): string;
  /**
   * Items to offer when inserting a reference, ranked for a typed `#…` query
   * (title, issue key, optional `type:` scope). Present means the editor can
   * insert references; absent keeps it render-only.
   */
  search?(query: string | null, options?: { limit?: number }): TrackerReferenceSearchResult;
  /** Present when the host can navigate to an item. */
  openItem?: (itemId: string) => void;
  /** The type's workflow status options, in schema order. */
  statusOptions?(type: string): TrackerReferenceStatusOption[];
  /** Writes flat field updates to a shared item. Absent means read-only. */
  updateItem?(itemId: string, updates: Record<string, unknown>): Promise<void>;
  /** Archives (or restores) an item; recoverable, unlike deleting it. */
  archiveItem?(itemId: string, archive: boolean): Promise<void>;
  currentActor?(): TrackerReferenceActor | null;
  /** Display name for an email, from identities recorded on loaded items. */
  personName?(email: string): string | null;
  dispose(): void;
}

export interface CreateTrackerReferenceResolverOptions {
  onOpenItem?: (itemId: string) => void;
  /** Defaults to the shared `globalRegistry` the browser schema store feeds. */
  schema?: TrackerReferenceSchema;
  currentActor?: () => TrackerReferenceActor | null;
  /** Display name from the host's member directory; consulted before item identities. */
  personName?: (email: string) => string | null;
}

const UNKNOWN_TYPE_COLOR = 'var(--nim-text-muted)';

/** Item changes held while waiting for the first snapshot. */
const MAX_PENDING_CHANGES = 500;

const CATEGORY_COLORS: Record<StatusCategory, string> = {
  backlog: 'var(--nim-text-faint)',
  unstarted: 'var(--nim-text-faint)',
  started: 'var(--nim-primary)',
  done: 'var(--nim-success)',
  cancelled: 'var(--nim-text-disabled)',
};

/** Values whose category alone reads wrong: both are "started", neither is progress. */
const STATUS_COLOR_BY_VALUE: Record<string, string> = {
  blocked: 'var(--nim-error)',
  disputed: 'var(--nim-warning)',
  'in-review': 'var(--nim-info)',
};

function humanize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function findField(model: TrackerDataModel | undefined, name: string): FieldDefinition | undefined {
  return model?.fields.find((field) => field.name === name);
}

function findOption(field: FieldDefinition | undefined, value: string): FieldOption | undefined {
  return field?.options?.find((option) => option.value === value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function sameItems(a: readonly TrackerItem[], b: readonly TrackerItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

interface Indexes {
  byId: Map<string, TrackerItem>;
  candidates: TrackerReferenceCandidate[];
  candidateTypes: Set<string>;
  byIssueKey: Map<string, TrackerItem>;
  claimsBySubject: Map<string, TrackerItem[]>;
  backlinksByTarget: Map<string, TrackerBacklink[]>;
  namesByEmail: Map<string, string>;
}

interface Cached<T> {
  version: number;
  value: T;
  /** Items the value was derived from, compared by identity on recompute. */
  deps: readonly TrackerItem[];
  schemaVersion: number;
}

export function createTrackerReferenceResolver(
  dataSource: TrackerDataSource,
  options: CreateTrackerReferenceResolverOptions = {},
): TrackerReferenceResolver {
  const schema: TrackerReferenceSchema = options.schema ?? globalRegistry;
  const listeners = new Set<() => void>();
  let items = new Map<string, TrackerItem>();
  let snapshotLoaded = false;
  let snapshotInFlight = false;
  let snapshotFailed = false;
  let hasSynced = false;
  let disposed = false;
  let version = 0;
  let schemaVersion = 0;
  let indexes: { version: number; value: Indexes } | null = null;
  // Item changes that arrive before the first snapshot, replayed on top of it
  // so the snapshot never overwrites a newer change. Bounded: on overflow the
  // queue is dropped and a fresh snapshot, which already contains those
  // changes, is taken instead.
  let pending: TrackerDataChange[] = [];
  let pendingOverflowed = false;

  const resolutions = new Map<string, Cached<TrackerReferenceResolution>>();
  const statements = new Map<string, Cached<readonly TrackerStatementGroup[]>>();
  const backlinkCache = new Map<string, Cached<readonly TrackerBacklink[]>>();

  const notify = () => {
    version += 1;
    for (const listener of [...listeners]) listener();
  };

  /**
   * Forget cached reads about items that no longer exist. A reader still
   * asking recomputes once (to `missing` or an empty list) and is cached again,
   * so identity stays stable between changes.
   */
  const evictRemoved = (removed: ReadonlySet<string>) => {
    if (removed.size === 0) return;
    for (const [key, entry] of resolutions) {
      if (entry.value.state === 'resolved' && removed.has(entry.value.item.id)) resolutions.delete(key);
    }
    for (const id of removed) {
      statements.delete(id);
      backlinkCache.delete(id);
    }
  };

  const replaceItems = (next: readonly TrackerItem[]) => {
    const previous = items;
    items = new Map(next.map((item) => [item.id, item]));
    evictRemoved(new Set([...previous.keys()].filter((id) => !items.has(id))));
  };

  /** Apply an item change to loaded state. Returns whether anything changed. */
  const applyItemChange = (change: TrackerDataChange): boolean => {
    switch (change.type) {
      case 'items-replaced':
        replaceItems(change.items);
        return true;
      case 'items-upserted':
        items = new Map(items);
        for (const item of change.items) items.set(item.id, item);
        return true;
      case 'items-removed':
        items = new Map(items);
        for (const id of change.itemIds) items.delete(id);
        evictRemoved(new Set(change.itemIds));
        return true;
      default:
        return false;
    }
  };

  const initialize = (initialItems: readonly TrackerItem[]) => {
    replaceItems(initialItems);
    snapshotLoaded = true;
    snapshotFailed = false;
    const queued = pending;
    pending = [];
    pendingOverflowed = false;
    for (const change of queued) applyItemChange(change);
    notify();
  };

  const requestSnapshot = () => {
    if (disposed || snapshotLoaded || snapshotInFlight) return;
    snapshotInFlight = true;
    snapshotFailed = false;
    dataSource.snapshot().then(
      (snapshot) => {
        snapshotInFlight = false;
        // An authoritative replacement may have initialized us meanwhile; it is
        // newer than this snapshot.
        if (disposed || snapshotLoaded) return;
        if (pendingOverflowed) {
          // Changes were dropped after this snapshot was requested, so it may
          // predate them. Take another one.
          pending = [];
          pendingOverflowed = false;
          requestSnapshot();
          return;
        }
        if (snapshot.sync?.status === 'connected') hasSynced = true;
        initialize(snapshot.items);
      },
      () => {
        // Retried on the next `connected` status, or superseded by an
        // `items-replaced`. Retrying immediately would spin on a persistent
        // failure; the data source's own status surface reports it.
        snapshotInFlight = false;
        snapshotFailed = true;
      },
    );
  };

  const handleChange = (change: TrackerDataChange) => {
    if (disposed) return;
    if (change.type === 'status') {
      const before = hasSynced;
      if (change.sync.status === 'connected') hasSynced = true;
      if (!snapshotLoaded && snapshotFailed && change.sync.status === 'connected') requestSnapshot();
      if (before !== hasSynced) notify();
      return;
    }
    if (snapshotLoaded) {
      if (applyItemChange(change)) notify();
      return;
    }
    if (change.type === 'items-replaced') {
      // The whole item set: initialization in its own right, and it supersedes
      // anything queued before it.
      initialize(change.items);
      return;
    }
    if (change.type !== 'items-upserted' && change.type !== 'items-removed') return;
    if (pending.length >= MAX_PENDING_CHANGES) {
      pending = [];
      pendingOverflowed = true;
      return;
    }
    if (!pendingOverflowed) pending.push(change);
  };

  if (dataSource.status()?.status === 'connected') hasSynced = true;
  const unsubscribeSource = dataSource.subscribe(handleChange);
  const unsubscribeSchema = schema.onChange(() => {
    if (disposed) return;
    schemaVersion += 1;
    notify();
  });
  requestSnapshot();

  const typeInfo = (type: string): TrackerReferenceTypeInfo => {
    const model = schema.get(type);
    return {
      type,
      displayName: model?.displayName ?? humanize(type),
      color: model?.color ?? UNKNOWN_TYPE_COLOR,
      icon: model?.icon ?? '',
    };
  };

  const statusFieldName = (model: TrackerDataModel | undefined) =>
    model?.roles?.workflowStatus ?? 'status';

  const statusInfo = (item: TrackerItem): TrackerReferenceStatusInfo | null => {
    const value = textOrNull(item.status);
    if (!value) return null;
    const model = schema.get(item.type);
    const option = findOption(findField(model, statusFieldName(model)), value);
    const category = option?.category;
    return {
      value,
      label: option?.label ?? humanize(value),
      color: option?.color
        ?? STATUS_COLOR_BY_VALUE[value]
        ?? (category ? CATEGORY_COLORS[category] : 'var(--nim-text-faint)'),
      ...(category ? { category } : {}),
    };
  };

  const fieldValue = (item: TrackerItem, fieldName: string): unknown =>
    readStoredFieldValue(item as unknown as Record<string, unknown>, fieldName);

  const relationshipTargets = (item: TrackerItem, fieldName: string): string[] =>
    normalizeRelationshipValue(fieldValue(item, fieldName))
      .map((value) => value.itemId)
      .filter((id): id is string => typeof id === 'string' && id !== '');

  const optionLabel = (type: string, fieldName: string, value: string): string =>
    findOption(findField(schema.get(type), fieldName), value)?.label ?? humanize(value);

  const predicateLabel = (predicateId: string): string =>
    schema.getPredicate(predicateId)?.label ?? humanize(predicateId);

  /**
   * Relationship fields for an item. Schema-declared ones when the type is
   * known; otherwise any custom field whose value is shaped like a relationship
   * (an object or array of objects carrying `itemId`), so an item whose schema
   * has not synced yet still contributes its backlinks.
   */
  const relationshipFieldNames = (item: TrackerItem): string[] => {
    const model = schema.get(item.type);
    if (model) return model.fields.filter(isRelationshipField).map((field) => field.name);
    const bag = item.customFields ?? {};
    return Object.keys(bag).filter((name) => {
      const raw = bag[name];
      const values = Array.isArray(raw) ? raw : [raw];
      return values.length > 0 && values.every(
        (value) => value && typeof value === 'object' && typeof (value as { itemId?: unknown }).itemId === 'string',
      );
    });
  };

  const getIndexes = (): Indexes => {
    if (indexes && indexes.version === version) return indexes.value;
    const byIssueKey = new Map<string, TrackerItem>();
    const claimsBySubject = new Map<string, TrackerItem[]>();
    const backlinksByTarget = new Map<string, TrackerBacklink[]>();
    const namesByEmail = new Map<string, string>();
    const candidates: TrackerReferenceCandidate[] = [];
    for (const item of items.values()) {
      candidates.push({
        id: item.id,
        issueKey: item.issueKey,
        issueNumber: item.issueNumber,
        title: item.title,
        description: item.description,
        status: item.status,
        type: item.type,
        typeTags: item.typeTags,
        archived: item.archived,
      });
      if (item.issueKey) byIssueKey.set(item.issueKey.toUpperCase(), item);
      for (const identity of [item.authorIdentity, item.lastModifiedBy]) {
        if (identity?.email && identity.displayName) namesByEmail.set(identity.email.toLowerCase(), identity.displayName);
      }
      if (item.type === 'claim') {
        for (const subjectId of relationshipTargets(item, 'subject')) {
          const list = claimsBySubject.get(subjectId) ?? [];
          list.push(item);
          claimsBySubject.set(subjectId, list);
        }
      }
      const model = schema.get(item.type);
      for (const fieldName of relationshipFieldNames(item)) {
        for (const value of normalizeRelationshipValue(fieldValue(item, fieldName))) {
          if (!value.itemId || value.itemId === item.id) continue;
          const list = backlinksByTarget.get(value.itemId) ?? [];
          if (list.some((existing) => existing.source === item && existing.fieldName === fieldName)) continue;
          const relationshipTypeKey = value.relationshipTypeKey ?? findField(model, fieldName)?.relationshipTypeKey;
          list.push({ source: item, fieldName, ...(relationshipTypeKey ? { relationshipTypeKey } : {}) });
          backlinksByTarget.set(value.itemId, list);
        }
      }
    }
    const value = {
      byId: items,
      candidates,
      candidateTypes: collectCandidateTypes(candidates),
      byIssueKey,
      claimsBySubject,
      backlinksByTarget,
      namesByEmail,
    };
    indexes = { version, value };
    return value;
  };

  /**
   * Return the cached value when nothing it was derived from changed, so
   * `useSyncExternalStore` sees the same reference and skips the render.
   */
  function memo<T>(
    cache: Map<string, Cached<T>>,
    key: string,
    compute: () => { value: T; deps: readonly TrackerItem[] },
    equal: (previous: T, next: T) => boolean,
  ): T {
    const cached = cache.get(key);
    if (cached && cached.version === version) return cached.value;
    const next = compute();
    if (
      cached
      && cached.schemaVersion === schemaVersion
      && sameItems(cached.deps, next.deps)
      && equal(cached.value, next.value)
    ) {
      cached.version = version;
      return cached.value;
    }
    cache.set(key, { version, value: next.value, deps: next.deps, schemaVersion });
    return next.value;
  }

  const resolve = (key: string): TrackerReferenceResolution => memo(
    resolutions,
    key,
    () => {
      const { byId, byIssueKey } = getIndexes();
      const item = byId.get(key) ?? byIssueKey.get(key.trim().toUpperCase());
      if (item) {
        return {
          value: { state: 'resolved', key, item, typeInfo: typeInfo(item.type), status: statusInfo(item) },
          deps: [item],
        };
      }
      return {
        value: { state: snapshotLoaded && hasSynced ? 'missing' : 'loading', key },
        deps: [],
      };
    },
    (previous, next) => previous.state === next.state,
  );

  const buildStatement = (claim: TrackerItem): TrackerStatement => {
    const predicateId = textOrNull(fieldValue(claim, 'predicate'));
    const basis = textOrNull(fieldValue(claim, 'basis'));
    const citations = fieldValue(claim, 'citations');
    return {
      claim,
      predicateId,
      objectItemId: relationshipTargets(claim, 'object')[0] ?? null,
      valueText: textOrNull(fieldValue(claim, 'valueText')),
      basis,
      basisLabel: basis ? optionLabel(claim.type, 'basis', basis) : null,
      applicability: textOrNull(fieldValue(claim, 'applicability')),
      citationCount: Array.isArray(citations) ? citations.length : citations ? 1 : 0,
      status: statusInfo(claim),
    };
  };

  const statementsAbout = (itemId: string): readonly TrackerStatementGroup[] => memo(
    statements,
    itemId,
    () => {
      const claims = (getIndexes().claimsBySubject.get(itemId) ?? [])
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title));
      const groups = new Map<string, TrackerStatementGroup>();
      for (const claim of claims) {
        const statement = buildStatement(claim);
        const groupKey = statement.predicateId ?? '';
        let group = groups.get(groupKey);
        if (!group) {
          group = {
            predicateId: statement.predicateId,
            label: statement.predicateId ? predicateLabel(statement.predicateId) : 'Unspecified',
            statements: [],
          };
          groups.set(groupKey, group);
        }
        group.statements.push(statement);
      }
      const value = [...groups.values()].sort((a, b) => {
        if (a.predicateId === null) return 1;
        if (b.predicateId === null) return -1;
        return a.label.localeCompare(b.label);
      });
      return { value, deps: claims };
    },
    () => true,
  );

  const backlinks = (itemId: string): readonly TrackerBacklink[] => memo(
    backlinkCache,
    itemId,
    () => {
      const value = (getIndexes().backlinksByTarget.get(itemId) ?? [])
        .slice()
        .sort((a, b) => a.source.title.localeCompare(b.source.title) || a.fieldName.localeCompare(b.fieldName));
      return { value, deps: value.map((link) => link.source) };
    },
    (previous, next) => previous.every((link, i) => link.fieldName === next[i]?.fieldName),
  );

  const search = (query: string | null, searchOptions: { limit?: number } = {}): TrackerReferenceSearchResult => {
    const { candidates, candidateTypes } = getIndexes();
    return searchTrackerReferenceCandidates(candidates, query, { knownTypes: candidateTypes, limit: searchOptions.limit });
  };

  const statusOptions = (type: string): TrackerReferenceStatusOption[] => {
    const model = schema.get(type);
    return (findField(model, statusFieldName(model))?.options ?? []).map((option) => ({
      value: option.value,
      label: option.label ?? humanize(option.value),
      ...(option.color ? { color: option.color } : {}),
      ...(option.category ? { category: option.category } : {}),
    }));
  };

  const currentActor = (): TrackerReferenceActor | null => options.currentActor?.() ?? null;

  const personName = (email: string): string | null => {
    const named = options.personName?.(email);
    if (named) return named;
    const actor = currentActor();
    if (actor?.name && actor.email.toLowerCase() === email.toLowerCase()) return actor.name;
    return getIndexes().namesByEmail.get(email.toLowerCase()) ?? null;
  };

  const updateItem = async (itemId: string, updates: Record<string, unknown>): Promise<void> => {
    await dataSource.command({ type: 'update-item', input: { itemId, updates, sharing: 'team' } });
  };

  const archiveItem = async (itemId: string, archive: boolean): Promise<void> => {
    await dataSource.command({ type: 'archive-item', itemId, archive });
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resolve,
    statementsAbout,
    backlinks,
    typeInfo,
    statusInfo,
    fieldValue,
    optionLabel,
    relationshipTargets,
    predicateLabel,
    search,
    ...(options.onOpenItem ? { openItem: options.onOpenItem } : {}),
    statusOptions,
    updateItem,
    archiveItem,
    currentActor,
    personName,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeSource();
      unsubscribeSchema();
      listeners.clear();
      items = new Map();
      indexes = null;
      pending = [];
      resolutions.clear();
      statements.clear();
      backlinkCache.clear();
    },
  };
}
