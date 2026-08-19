/**
 * YAML parser for tracker data model definitions
 */

import yaml from 'js-yaml';
import type { TrackerDataModel, FieldDefinition, FieldOption, TrackerSharing, TrackerSchemaRole } from './TrackerDataModel';

type LegacyTrackerSharing = 'local' | 'shared' | 'hybrid';

function legacySharing(mode: LegacyTrackerSharing): { sharing: TrackerSharing; draftByDefault: boolean } {
  if (mode === 'local') return { sharing: 'personal', draftByDefault: false };
  return { sharing: 'team', draftByDefault: mode === 'hybrid' };
}

/** Normalize a parsed/JSON model without requiring a full YAML validation pass. */
export function normalizeTrackerSharingModel<T extends TrackerDataModel>(model: T, fallbackSharing: TrackerSharing = 'personal'): T {
  const legacyMode = (model as TrackerDataModel & { sync?: { mode?: LegacyTrackerSharing } }).sync?.mode;
  const migrated = legacyMode && ['local', 'shared', 'hybrid'].includes(legacyMode)
    ? legacySharing(legacyMode)
    : null;
  const { sync: _legacySync, ...rest } = model as TrackerDataModel & { sync?: unknown };
  const sharing = model.sharing === 'team' || model.sharing === 'personal'
    ? model.sharing
    : migrated?.sharing ?? fallbackSharing;
  return {
    ...rest,
    sharing,
    draftByDefault: sharing === 'team' ? model.draftByDefault ?? migrated?.draftByDefault ?? false : false,
  } as T;
}

/**
 * Parse a YAML string into a TrackerDataModel
 */
export function parseTrackerYAML(yamlString: string): TrackerDataModel {
  const data = yaml.load(yamlString) as any;

  if (!data) {
    throw new Error('Empty YAML document');
  }

  // Validate required fields
  if (!data.type) throw new Error('Missing required field: type');
  if (!data.displayName) throw new Error('Missing required field: displayName');
  if (!data.displayNamePlural) throw new Error('Missing required field: displayNamePlural');
  if (!data.icon) throw new Error('Missing required field: icon');
  if (!data.color) throw new Error('Missing required field: color');
  if (!data.modes) throw new Error('Missing required field: modes');
  if (!data.idPrefix) throw new Error('Missing required field: idPrefix');
  if (!data.fields || !Array.isArray(data.fields)) {
    throw new Error('Missing or invalid field: fields (must be an array)');
  }

  // Parse fields
  const fields: FieldDefinition[] = data.fields.map((field: any) => {
    if (!field.name) throw new Error('Field missing required property: name');
    if (!field.type) throw new Error(`Field '${field.name}' missing required property: type`);

    const fieldDef: FieldDefinition = {
      name: field.name,
      type: field.type,
      required: field.required || false,
      default: field.default,
      displayInline: field.displayInline !== undefined ? field.displayInline : true,
    };

    if (field.readOnly !== undefined) fieldDef.readOnly = field.readOnly;

    // Add type-specific properties
    if (field.minLength !== undefined) fieldDef.minLength = field.minLength;
    if (field.maxLength !== undefined) fieldDef.maxLength = field.maxLength;
    if (field.min !== undefined) fieldDef.min = field.min;
    if (field.max !== undefined) fieldDef.max = field.max;
    if (field.itemType !== undefined) fieldDef.itemType = field.itemType;

    // Relationship-field properties (Epic C / NIM-870). Without these the parsed
    // FieldDefinition collapses to a single-value link with no target/vocab
    // enforcement, even though the on-disk schema declared them.
    if (field.relationshipTypeKey !== undefined) fieldDef.relationshipTypeKey = field.relationshipTypeKey;
    if (field.targetTrackerTypes !== undefined) fieldDef.targetTrackerTypes = field.targetTrackerTypes;
    if (field.multiValue !== undefined) fieldDef.multiValue = field.multiValue;
    if (field.inverseFieldId !== undefined) fieldDef.inverseFieldId = field.inverseFieldId;
    if (field.inverseRelationshipTypeKey !== undefined) fieldDef.inverseRelationshipTypeKey = field.inverseRelationshipTypeKey;
    if (field.symmetric !== undefined) fieldDef.symmetric = field.symmetric;
    if (field.preventsCompletion !== undefined) fieldDef.preventsCompletion = field.preventsCompletion;
    if (field.childRelationship !== undefined) fieldDef.childRelationship = field.childRelationship;
    if (field.allowSelfLink !== undefined) fieldDef.allowSelfLink = field.allowSelfLink;

    // Parse options for select/multiselect
    if (field.options && Array.isArray(field.options)) {
      fieldDef.options = field.options.map((opt: any) => {
        if (typeof opt === 'string') {
          // Simple string option
          return {
            value: opt.toLowerCase().replace(/\s+/g, '-'),
            label: opt,
          } as FieldOption;
        } else if (typeof opt === 'object') {
          // Object with value, label, icon, color
          return {
            value: opt.value,
            label: opt.label,
            icon: opt.icon,
            color: opt.color,
          } as FieldOption;
        }
        throw new Error(`Invalid option format in field '${field.name}'`);
      });
    }

    // Parse schema for array/object types
    if (field.schema && Array.isArray(field.schema)) {
      fieldDef.schema = field.schema.map((subField: any) => ({
        name: subField.name,
        type: subField.type,
        required: subField.required || false,
      }));
    }

    return fieldDef;
  });

  const model: TrackerDataModel = {
    type: data.type,
    displayName: data.displayName,
    displayNamePlural: data.displayNamePlural,
    icon: data.icon,
    color: data.color,
    modes: {
      inline: data.modes.inline !== false,
      fullDocument: data.modes.fullDocument === true,
    },
    idPrefix: data.idPrefix,
    idFormat: data.idFormat || 'ulid',
    fields,
  };

  // Optional properties
  if (data.statusBarLayout) {
    model.statusBarLayout = data.statusBarLayout;
  }

  if (data.inlineTemplate) {
    model.inlineTemplate = data.inlineTemplate;
  }

  // Optional plural + top-level behavior flags. These must round-trip so a
  // bundled builtin YAML reproduces the model exactly (e.g. automation is
  // `creatable: false`); without them the parsed model silently diverges.
  if (data.creatable !== undefined) model.creatable = data.creatable;
  if (data.primaryCapable !== undefined) model.primaryCapable = data.primaryCapable;
  if (data.supportsTags !== undefined) model.supportsTags = data.supportsTags;

  if (data.tableView) {
    model.tableView = {
      defaultColumns: data.tableView.defaultColumns || [],
      sortable: data.tableView.sortable !== false,
      filterable: data.tableView.filterable !== false,
      exportable: data.tableView.exportable !== false,
    };
  }

  // Parse roles
  if (data.roles && typeof data.roles === 'object') {
    const validRoles: TrackerSchemaRole[] = [
      'title', 'workflowStatus', 'priority', 'assignee', 'reporter',
      'tags', 'startDate', 'dueDate', 'progress', 'externalKey', 'prMergedStatus',
    ];
    const roles: Partial<Record<TrackerSchemaRole, string>> = {};
    for (const [key, value] of Object.entries(data.roles)) {
      if (validRoles.includes(key as TrackerSchemaRole) && typeof value === 'string') {
        roles[key as TrackerSchemaRole] = value;
      }
    }
    if (Object.keys(roles).length > 0) {
      model.roles = roles;
    }
  }

  // New files carry one tracker-level sharing axis. Legacy sync.mode remains a
  // permanent read format because users check these files into git.
  const validSharings: TrackerSharing[] = ['personal', 'team'];
  const legacyModes: LegacyTrackerSharing[] = ['local', 'shared', 'hybrid'];
  const legacyMode = legacyModes.includes(data.sync?.mode) ? data.sync.mode as LegacyTrackerSharing : null;
  const migrated = legacyMode ? legacySharing(legacyMode) : null;
  model.sharing = validSharings.includes(data.sharing)
    ? data.sharing
    : migrated?.sharing ?? 'personal';
  model.draftByDefault = model.sharing === 'team'
    ? (typeof data.draftByDefault === 'boolean' ? data.draftByDefault : migrated?.draftByDefault ?? false)
    : false;
  // Only written when true: an unarchived tracker is the overwhelming majority
  // and `archived: false` on every file would be noise.
  if (data.archived === true) model.archived = true;

  return model;
}

/**
 * Serialize a TrackerDataModel to YAML string
 */
export function serializeTrackerYAML(model: TrackerDataModel): string {
  return yaml.dump(normalizeTrackerSharingModel(model), {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
  });
}

/**
 * Validate a YAML string without fully parsing
 */
export function validateTrackerYAML(yamlString: string): { valid: boolean; error?: string } {
  try {
    parseTrackerYAML(yamlString);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
