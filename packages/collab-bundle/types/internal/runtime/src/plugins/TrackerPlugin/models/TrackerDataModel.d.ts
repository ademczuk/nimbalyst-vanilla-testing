/**
 * Core types and interfaces for the unified tracker system
 */
import type { StatusCategory } from './trackerStatusCategory';
export type FieldType = 'string' | 'text' | 'number' | 'select' | 'multiselect' | 'date' | 'datetime' | 'boolean' | 'user'
/** First-class link to other tracker item(s). See {@link RelationshipFieldDefinition}. */
 | 'relationship'
/** @deprecated Legacy inert link type; treated as a `relationship` alias. */
 | 'reference' | 'url' | 'array' | 'object';
/**
 * Stored shape of a 'url' field. The label is optional and renders as the
 * display text when present; otherwise the URL itself is shown.
 */
export interface UrlFieldValue {
    url: string;
    label?: string;
}
export interface FieldOption {
    value: string;
    label: string;
    icon?: string;
    color?: string;
    /**
     * Lifecycle position, on the field carrying the `workflowStatus` role.
     * Declared rather than inferred from the value's name — see
     * `trackerStatusCategory.ts` for why, and for what an absent category
     * resolves to. Ignored on every other select field.
     */
    category?: StatusCategory;
}
export interface FieldDefinition {
    name: string;
    type: FieldType;
    required?: boolean;
    default?: any;
    displayInline?: boolean;
    readOnly?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    options?: FieldOption[];
    itemType?: FieldType;
    schema?: FieldDefinition[];
    /** Vocabulary/behavior key, e.g. `depends-on`, `blocks`, `relates-to`. */
    relationshipTypeKey?: string;
    /** Allowed target tracker types, or `'*'` for any. */
    targetTrackerTypes?: string[] | '*';
    /** True = array of targets (add-wins set); false/undefined = single target. */
    multiValue?: boolean;
    /** Field id on the target type that holds the inverse value (Phase 3). */
    inverseFieldId?: string;
    /** Relationship key of the inverse direction, e.g. `blocks` for `depends-on`. */
    inverseRelationshipTypeKey?: string;
    /** The relationship reads the same both directions (e.g. `relates-to`). */
    symmetric?: boolean;
    /** Unresolved targets block marking the owning item complete. */
    preventsCompletion?: boolean;
    /** Models a parent/child hierarchy edge (cycle-checked in field-aware tools). */
    childRelationship?: boolean;
    /** Allow an item to link to itself on this field (default: reject self-links). */
    allowSelfLink?: boolean;
}
/**
 * A single related-item reference stored inside a relationship field's value.
 *
 * Carries enough denormalized display data (title, type, issueKey) to render a
 * pill without a lookup on every paint. `itemId` is the stable identity used for
 * dedup and the add-wins set semantics.
 */
export interface TrackerRelationshipValue {
    itemId: string;
    issueKey?: string;
    title?: string;
    trackerType?: string;
    relationshipTypeKey?: string;
    direction?: 'out';
    metadata?: Record<string, unknown>;
}
export interface StatusBarLayoutRow {
    row: Array<{
        field: string;
        width: number | 'auto';
    }>;
}
export interface TrackerModes {
    inline: boolean;
    fullDocument: boolean;
}
export interface TableViewConfig {
    defaultColumns: string[];
    sortable: boolean;
    filterable: boolean;
    exportable: boolean;
}
/** A tracker owns its schema and items together: personally or as a team artifact. */
export type TrackerSharing = 'personal' | 'team';
export interface TrackerSharingPolicy {
    sharing: TrackerSharing;
    /** Team trackers can create private drafts while reusing the existing per-item published bit. */
    draftByDefault: boolean;
}
/**
 * Semantic roles that map product concepts to schema-defined field names.
 * A role answers "which field in this schema represents X?" so the product
 * can find e.g. the workflow status field without assuming it's called "status".
 */
export type TrackerSchemaRole = 'title' | 'workflowStatus' | 'priority' | 'assignee' | 'reporter' | 'tags' | 'startDate' | 'dueDate' | 'progress'
/**
 * Field carrying the item's external identity (e.g. a PR number or imported
 * issue key). Shown next to the local issue key on compact surfaces like
 * kanban cards. url-type fields contribute their display label.
 */
 | 'externalKey'
/**
 * Unlike the other roles, this maps to a STATUS VALUE (not a field name):
 * the workflow status to set when a pull request referenced by an item of
 * this type is merged from the PR view. Types that omit it get an activity
 * comment on merge instead of a status transition.
 */
 | 'prMergedStatus';
export interface TrackerDataModel {
    type: string;
    displayName: string;
    displayNamePlural: string;
    icon: string;
    color: string;
    modes: TrackerModes;
    idPrefix: string;
    idFormat: 'ulid' | 'uuid' | 'sequential';
    fields: FieldDefinition[];
    statusBarLayout?: StatusBarLayoutRow[];
    inlineTemplate?: string;
    tableView?: TableViewConfig;
    /** Whether the tracker schema and its items are personal or team-owned. Defaults to personal. */
    sharing?: TrackerSharing;
    /** Whether new items in a team tracker begin as private drafts. Defaults to false. */
    draftByDefault?: boolean;
    /**
     * Retired: the tracker is no longer used, but every item is kept, stays
     * visible and searchable, and keeps its issue key. Archiving is the answer to
     * "we should stop using this tracker" — it is deliberately NOT a demotion
     * back to personal, which would strand teammates' items, and NOT a delete.
     * Read-only is the only behavioral consequence.
     */
    archived?: boolean;
    /** If false, items of this type cannot be created via tracker_create. Defaults to true. */
    creatable?: boolean;
    /** Whether this type can be used as a primary type. Defaults to true. */
    primaryCapable?: boolean;
    /**
     * Opt out of the auto-injected `tags` field/role. Defaults to true (tags supported).
     * The registry adds a standard `tags` array field and declares the `tags` role
     * when neither is already present, so every tracker type gets consistent tag
     * behavior without each schema needing to restate it.
     */
    supportsTags?: boolean;
    /**
     * Maps semantic roles to field names in this schema.
     * Allows the product to find e.g. "which field is the workflow status?"
     * without hardcoding field names like "status".
     */
    roles?: Partial<Record<TrackerSchemaRole, string>>;
}
/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: Array<{
        field: string;
        message: string;
    }>;
    /**
     * Non-fatal issues that must NOT block a write. An unknown select value (a
     * status an override removed/renamed, or one a peer on a different schema set)
     * lands here so the value is preserved rather than destroyed — the write path
     * treats warnings as advisory. See configurable-builtin-tracker-types plan.
     */
    warnings?: Array<{
        field: string;
        message: string;
    }>;
}
/**
 * Data model registry
 */
export declare class TrackerDataModelRegistry {
    private models;
    /** Track which types are built-in (survive workspace switches) vs workspace-specific */
    private builtinTypes;
    /** Original built-in definitions, so a workspace override can be cleared. */
    private builtinModels;
    private listeners;
    /**
     * Schema layers for workspaces OTHER than the active one (path -> type -> model).
     *
     * The `models` map above is the resolved view of the ACTIVE workspace. A
     * background reader (the in-process MCP server serving a tool call for a
     * different project) must be able to see that project's custom types without
     * overwriting the active project's identically-named types — the registry is
     * keyed by type name only, so `register()` from workspace B used to silently
     * replace workspace A's `widget` schema and corrupt A's validation (#1035).
     */
    private workspaceLayers;
    /** Workspace path that `models` currently represents, if any. */
    private activeWorkspace;
    /**
     * Supplies the workspace a read should resolve against, when the caller is
     * operating on behalf of a non-active workspace. Installed by the host
     * (Electron main uses AsyncLocalStorage); undefined means "use the active view".
     */
    private scopeProvider;
    register(model: TrackerDataModel, builtin?: boolean): void;
    /** Remove a specific type from the registry. Cannot remove built-in types. */
    unregister(type: string): boolean;
    /**
     * Remove one workspace-provided schema. Built-in overrides restore the
     * original built-in model; custom workspace types are deleted.
     */
    clearWorkspaceSchema(type: string): boolean;
    /**
     * Remove all workspace-specific (non-builtin) schemas.
     * Call this on workspace switch to prevent schemas from workspace A
     * leaking into workspace B.
     */
    clearWorkspaceSchemas(): void;
    /** Subscribe to registry changes. Returns an unsubscribe function. */
    onChange(fn: () => void): () => void;
    /**
     * Install the ambient scope resolver. The host calls this once; returning a
     * workspace path from `fn` makes reads on the current async context resolve
     * against that workspace's layer instead of the active view.
     */
    setScopeProvider(fn: (() => string | null | undefined) | null): void;
    /**
     * Declare which workspace the live `models` view represents. Any cached layer
     * for that workspace is dropped — the live view supersedes it (and the caller
     * reloads it from disk).
     */
    setActiveWorkspace(workspacePath: string | null): void;
    /** The workspace the live view currently represents, if declared. */
    getActiveWorkspace(): string | null;
    /**
     * Replace the cached schema layer for a NON-active workspace. Does not touch
     * the active view, so a read-only lookup for another project can never
     * clobber the open project's schemas. No change notification is emitted:
     * nothing the active workspace can observe has changed.
     */
    setWorkspaceLayer(workspacePath: string, models: TrackerDataModel[]): void;
    /** Drop a cached non-active workspace layer. */
    clearWorkspaceLayer(workspacePath: string): void;
    /**
     * The layer a read should resolve against, or null to use the active view.
     *
     * When no workspace has claimed the live view (`activeWorkspace === null`)
     * every read stays unscoped: the view is nobody's to corrupt, and scoping it
     * would hide types registered before any workspace window opened (NIM-760).
     */
    private scopedLayer;
    get(type: string): TrackerDataModel | undefined;
    /** True when a cached layer exists for a non-active workspace. */
    hasWorkspaceLayer(workspacePath: string): boolean;
    /**
     * Resolve a type on behalf of an EXPLICIT workspace, with no dependence on
     * ambient async context (#1359 / NIM-3702).
     *
     * `get()` reaches the right answer only when a scope provider is installed on
     * the current async context, which is true for exactly one consumer — the MCP
     * HTTP server, which wraps a whole request. The tracker sync lane is driven
     * from a WebSocket `onStatusChange` callback that has no such relationship to
     * whoever opened the workspace, so it lost the scope and read the *other*
     * project's schemas. Callers that already hold a workspace path use this.
     *
     * Note the builtin fallback: `get()`'s unscoped branch does not have one, so
     * a miss there returned `undefined` even for `bug`/`task`/`plan`/`decision`,
     * all of which ship `sharing: team`. Both branches fall back here.
     */
    getForWorkspace(workspacePath: string | null | undefined, type: string): TrackerDataModel | undefined;
    getAll(): TrackerDataModel[];
    has(type: string): boolean;
    isBuiltin(type: string): boolean;
    /**
     * The original built-in model for a type, if any — the seed that a workspace
     * or synced patch layers onto. Unaffected by workspace overrides currently in
     * the `models` map, so patch resolution never double-applies.
     */
    getBuiltinModel(type: string): TrackerDataModel | undefined;
    validate(type: string, data: Record<string, any>): ValidationResult;
}
export declare const globalRegistry: TrackerDataModelRegistry;
/**
 * Ensure a tracker model has tag support unless it explicitly opts out via
 * `supportsTags: false`. Adds the `tags` field and/or the `tags` role if they
 * aren't already declared. Returns the original model unchanged when nothing
 * needs to be added, so models that already declare tags keep their exact
 * field ordering and custom role target.
 */
export declare function ensureTagsSupport(model: TrackerDataModel): TrackerDataModel;
/**
 * Get the field name that fulfills a given role in a tracker data model.
 * Returns undefined if the model doesn't declare that role.
 */
export declare function getRoleField(model: TrackerDataModel, role: TrackerSchemaRole): string | undefined;
/**
 * Look up the FieldDefinition for a role in a given tracker type.
 * Returns undefined if the type doesn't exist, doesn't declare the role,
 * or the role's field name doesn't match any field definition.
 */
export declare function getFieldByRole(registry: TrackerDataModelRegistry, type: string, role: TrackerSchemaRole): FieldDefinition | undefined;
/**
 * Resolve the available fields for an item with multiple type tags.
 * Returns the union of all tag types' fields. Primary type (first tag) takes
 * precedence for duplicate field names.
 */
export declare function resolveFields(typeTags: string[]): FieldDefinition[];
