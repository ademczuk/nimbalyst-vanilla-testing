/**
 * Predicate registry (knowledge-scopes contract 4.1).
 *
 * A predicate is the verb in a statement: `product --integrates-with--> product`,
 * qualified by "via which connector", "which operations", "tested against which
 * client version". The registry is the declaration of those verbs, and it is a
 * SCHEMA ARTIFACT, not project configuration. Per decision 12 the room owns it
 * and publishes it to every client exactly like a type definition;
 * `.nimbalyst/predicates.yaml` is a local copy, never the distribution
 * mechanism. The transport lives in `schemaSyncPayload.ts` and rides the lane
 * type definitions already ride.
 *
 * This module is pure: plain objects in, issues out. It is reachable from
 * desktop, the web console, the collab server (which depends on this package
 * for C3/C4/C5), and both MCP surfaces, which is the whole point -- section 7
 * requires that "a predicate with required qualifiers rejects a claim missing
 * them" report the SAME code on all four.
 *
 * Three properties shape this file, and they are the same three that shape
 * `./citationLocator.ts` for the same reasons.
 *
 * **Stable codes.** Every failure carries a `PREDICATE_*` code and a property
 * path. A message is for a person; a code is what a caller may branch on.
 *
 * **Strict in both directions.** An unknown qualifier, an unknown property on a
 * predicate declaration, and an unknown qualifier type are all rejections. The
 * concrete failure a tolerant reader produces here: `operation` for
 * `operations` is dropped, the required qualifier reads as missing, and the
 * author is told to supply a qualifier they believe they just supplied. Worse,
 * with `required` absent it is accepted and the statement claims a precision
 * nobody wrote.
 *
 * **Every issue in one pass.** A form or an MCP caller fixes a value in one
 * round trip rather than one per property.
 *
 * What this module does NOT do: resolve a relationship target, read items, or
 * decide whether a registry change is safe. That last one is
 * `./trackerPredicateRegistryChangeClassifier.ts`, which applies the same
 * additive-versus-destructive rule type schemas already get.
 */

/**
 * What the object of a statement is. A predicate's value shape and the field
 * carrying it have to agree, or the field stores something the predicate does
 * not describe. See {@link predicateValueShapeAcceptsFieldType}.
 */
export type PredicateValueShape =
  | 'entity'
  | 'text'
  | 'boolean-assessment'
  | 'quantity'
  | 'select';

export const PREDICATE_VALUE_SHAPES: readonly PredicateValueShape[] = [
  'entity',
  'text',
  'boolean-assessment',
  'quantity',
  'select',
];

/** `symmetric` reads the same both ways (`relates-to`); `directed` does not. */
export type PredicateDirection = 'directed' | 'symmetric';

export const PREDICATE_DIRECTIONS: readonly PredicateDirection[] = ['directed', 'symmetric'];

export type PredicateQualifierType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'relationship'
  | 'array';

export const PREDICATE_QUALIFIER_TYPES: readonly PredicateQualifierType[] = [
  'string',
  'number',
  'boolean',
  'date',
  'select',
  'relationship',
  'array',
];

/** Item types an `array` qualifier may hold. Nested objects are deliberately absent. */
export type PredicateQualifierItemType = 'string' | 'number' | 'boolean';

export const PREDICATE_QUALIFIER_ITEM_TYPES: readonly PredicateQualifierItemType[] = [
  'string',
  'number',
  'boolean',
];

export interface PredicateQualifierDefinition {
  type: PredicateQualifierType;
  /** Absent means optional. A qualifier becoming required is a destructive change. */
  required?: boolean;
  /** For `array`. Absent accepts any of {@link PREDICATE_QUALIFIER_ITEM_TYPES}. */
  itemType?: PredicateQualifierItemType;
  /** For `select`. Values, not labels: a qualifier is data, not presentation. */
  options?: string[];
  /** For `relationship`. Allowed target tracker types, or `'*'` for any. */
  targetTrackerTypes?: string[] | '*';
  /** Presentation only; never affects validation or change classification. */
  label?: string;
  /** Presentation only. */
  description?: string;
}

export interface PredicateDefinition {
  id: string;
  label: string;
  /** How the statement reads from the object's side. Presentation only. */
  inverseLabel?: string;
  /**
   * Tracker types that may be the subject. `['*']` accepts any. A derived type
   * satisfies a base listed here -- see {@link isSubjectKindAllowed} -- which is
   * what lets a workspace declare predicates against `entity` while
   * domain-specific schemas narrow the kinds that extend it.
   */
  subjectKinds: string[];
  valueShape: PredicateValueShape;
  direction: PredicateDirection;
  /** Advisory for traversal; nothing in this package walks a transitive closure. */
  transitive?: boolean;
  qualifiers?: Record<string, PredicateQualifierDefinition>;
}

export type PredicateErrorCode =
  // Declaration shape
  | 'PREDICATE_NOT_AN_OBJECT'
  | 'PREDICATE_MISSING_FIELD'
  | 'PREDICATE_INVALID_FIELD'
  | 'PREDICATE_UNKNOWN_FIELD'
  | 'PREDICATE_DUPLICATE_ID'
  | 'PREDICATE_REGISTRY_NOT_AN_ARRAY'
  // Field declaration against the registry
  | 'PREDICATE_UNKNOWN'
  | 'PREDICATE_VALUE_SHAPE_MISMATCH'
  | 'PREDICATE_SUBJECT_KIND_NOT_ALLOWED'
  // Write-time qualifier values
  | 'PREDICATE_QUALIFIERS_NOT_AN_OBJECT'
  | 'PREDICATE_QUALIFIER_REQUIRED'
  | 'PREDICATE_QUALIFIER_UNKNOWN'
  | 'PREDICATE_QUALIFIER_INVALID_TYPE'
  | 'PREDICATE_QUALIFIER_INVALID_OPTION';

export interface PredicateIssue {
  code: PredicateErrorCode;
  /** The offending property, or `''` when the subject as a whole is at fault. */
  path: string;
  message: string;
}

function issue(code: PredicateErrorCode, path: string, message: string): PredicateIssue {
  return { code, path, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Predicate and qualifier ids are wire keys: kebab-ish, no spaces, no dots. */
const PREDICATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const QUALIFIER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

const PREDICATE_KEYS: readonly string[] = [
  'id',
  'label',
  'inverseLabel',
  'subjectKinds',
  'valueShape',
  'direction',
  'transitive',
  'qualifiers',
];

const QUALIFIER_KEYS: readonly string[] = [
  'type',
  'required',
  'itemType',
  'options',
  'targetTrackerTypes',
  'label',
  'description',
];

// ---------------------------------------------------------------------------
// Declaration validation
// ---------------------------------------------------------------------------

export type PredicateDefinitionValidation =
  | { valid: true; predicate: PredicateDefinition; issues: [] }
  | { valid: false; predicate: null; issues: PredicateIssue[] };

/**
 * Validate one predicate declaration. Returns the narrowed definition on
 * success and every issue on failure, never a partially-accepted value: a
 * predicate missing half its qualifier declarations validates writes against a
 * contract nobody authored.
 */
export function validatePredicateDefinition(value: unknown): PredicateDefinitionValidation {
  if (!isPlainObject(value)) {
    return {
      valid: false,
      predicate: null,
      issues: [issue('PREDICATE_NOT_AN_OBJECT', '', 'A predicate declaration must be an object')],
    };
  }

  const issues: PredicateIssue[] = [];

  for (const key of Object.keys(value)) {
    if (!PREDICATE_KEYS.includes(key)) {
      issues.push(issue('PREDICATE_UNKNOWN_FIELD', key, `'${key}' is not part of a predicate declaration`));
    }
  }

  requireString(value, 'id', issues, {
    re: PREDICATE_ID_PATTERN,
    expectation: 'must be lowercase letters, digits, and hyphens',
  });
  requireString(value, 'label', issues);
  checkOptionalString(value, 'inverseLabel', issues);

  if (value.subjectKinds === undefined) {
    issues.push(issue('PREDICATE_MISSING_FIELD', 'subjectKinds', `'subjectKinds' is required`));
  } else if (
    !Array.isArray(value.subjectKinds)
    || value.subjectKinds.length === 0
    || value.subjectKinds.some(kind => typeof kind !== 'string' || kind.trim().length === 0)
  ) {
    issues.push(
      issue(
        'PREDICATE_INVALID_FIELD',
        'subjectKinds',
        `'subjectKinds' must be a non-empty array of tracker type names, or ['*']`,
      ),
    );
  }

  requireEnum(value, 'valueShape', PREDICATE_VALUE_SHAPES, issues);
  requireEnum(value, 'direction', PREDICATE_DIRECTIONS, issues);

  if (value.transitive !== undefined && typeof value.transitive !== 'boolean') {
    issues.push(issue('PREDICATE_INVALID_FIELD', 'transitive', `'transitive' must be a boolean when present`));
  }

  if (value.qualifiers !== undefined) {
    if (!isPlainObject(value.qualifiers)) {
      issues.push(issue('PREDICATE_INVALID_FIELD', 'qualifiers', `'qualifiers' must be an object keyed by qualifier name`));
    } else {
      for (const [name, declaration] of Object.entries(value.qualifiers)) {
        validateQualifierDeclaration(name, declaration, issues);
      }
    }
  }

  if (issues.length > 0) return { valid: false, predicate: null, issues };
  return { valid: true, predicate: value as unknown as PredicateDefinition, issues: [] };
}

function validateQualifierDeclaration(
  name: string,
  declaration: unknown,
  issues: PredicateIssue[],
): void {
  const base = `qualifiers.${name}`;
  if (!QUALIFIER_NAME_PATTERN.test(name)) {
    issues.push(
      issue('PREDICATE_INVALID_FIELD', base, `Qualifier name '${name}' must start with a letter and contain no spaces or dots`),
    );
  }
  if (!isPlainObject(declaration)) {
    issues.push(issue('PREDICATE_INVALID_FIELD', base, `Qualifier '${name}' must be an object`));
    return;
  }

  for (const key of Object.keys(declaration)) {
    if (!QUALIFIER_KEYS.includes(key)) {
      issues.push(issue('PREDICATE_UNKNOWN_FIELD', `${base}.${key}`, `'${key}' is not part of a qualifier declaration`));
    }
  }

  const type = declaration.type;
  if (type === undefined) {
    issues.push(issue('PREDICATE_MISSING_FIELD', `${base}.type`, `Qualifier '${name}' is missing 'type'`));
  } else if (typeof type !== 'string' || !PREDICATE_QUALIFIER_TYPES.includes(type as PredicateQualifierType)) {
    issues.push(
      issue(
        'PREDICATE_INVALID_FIELD',
        `${base}.type`,
        `Qualifier '${name}' has unknown type '${String(type)}'; expected one of ${PREDICATE_QUALIFIER_TYPES.join(', ')}`,
      ),
    );
  }

  if (declaration.required !== undefined && typeof declaration.required !== 'boolean') {
    issues.push(issue('PREDICATE_INVALID_FIELD', `${base}.required`, `'required' must be a boolean when present`));
  }

  if (declaration.itemType !== undefined) {
    if (
      typeof declaration.itemType !== 'string'
      || !PREDICATE_QUALIFIER_ITEM_TYPES.includes(declaration.itemType as PredicateQualifierItemType)
    ) {
      issues.push(
        issue(
          'PREDICATE_INVALID_FIELD',
          `${base}.itemType`,
          `'itemType' must be one of ${PREDICATE_QUALIFIER_ITEM_TYPES.join(', ')}`,
        ),
      );
    } else if (type !== 'array') {
      issues.push(
        issue('PREDICATE_INVALID_FIELD', `${base}.itemType`, `'itemType' only applies to an 'array' qualifier`),
      );
    }
  }

  if (declaration.options !== undefined) {
    if (
      !Array.isArray(declaration.options)
      || declaration.options.length === 0
      || declaration.options.some(option => typeof option !== 'string' || option.length === 0)
    ) {
      issues.push(
        issue('PREDICATE_INVALID_FIELD', `${base}.options`, `'options' must be a non-empty array of strings`),
      );
    } else if (type !== 'select') {
      issues.push(
        issue('PREDICATE_INVALID_FIELD', `${base}.options`, `'options' only applies to a 'select' qualifier`),
      );
    }
  } else if (type === 'select') {
    issues.push(
      issue('PREDICATE_MISSING_FIELD', `${base}.options`, `A 'select' qualifier must declare 'options'`),
    );
  }

  if (declaration.targetTrackerTypes !== undefined) {
    const targets = declaration.targetTrackerTypes;
    const wellFormed = targets === '*'
      || (Array.isArray(targets)
        && targets.length > 0
        && targets.every(t => typeof t === 'string' && t.length > 0));
    if (!wellFormed) {
      issues.push(
        issue(
          'PREDICATE_INVALID_FIELD',
          `${base}.targetTrackerTypes`,
          `'targetTrackerTypes' must be '*' or a non-empty array of tracker type names`,
        ),
      );
    } else if (type !== 'relationship') {
      issues.push(
        issue(
          'PREDICATE_INVALID_FIELD',
          `${base}.targetTrackerTypes`,
          `'targetTrackerTypes' only applies to a 'relationship' qualifier`,
        ),
      );
    }
  }

  checkOptionalString(declaration, 'label', issues, base);
  checkOptionalString(declaration, 'description', issues, base);
}

export type PredicateRegistryValidation =
  | { valid: true; predicates: PredicateDefinition[]; issues: [] }
  | { valid: false; predicates: null; issues: PredicateIssue[] };

/**
 * Validate a whole registry. Entry issues are prefixed with the index, and a
 * duplicate id is reported on the later entry: two declarations of one verb
 * means every write validates against whichever happened to be registered last.
 */
export function validatePredicateRegistry(value: unknown): PredicateRegistryValidation {
  if (!Array.isArray(value)) {
    return {
      valid: false,
      predicates: null,
      issues: [issue('PREDICATE_REGISTRY_NOT_AN_ARRAY', '', 'A predicate registry must be an array of declarations')],
    };
  }

  const issues: PredicateIssue[] = [];
  const predicates: PredicateDefinition[] = [];
  const seen = new Set<string>();

  value.forEach((entry, index) => {
    const result = validatePredicateDefinition(entry);
    if (!result.valid) {
      for (const entryIssue of result.issues) {
        issues.push({
          ...entryIssue,
          path: entryIssue.path ? `[${index}].${entryIssue.path}` : `[${index}]`,
        });
      }
      return;
    }
    if (seen.has(result.predicate.id)) {
      issues.push(
        issue('PREDICATE_DUPLICATE_ID', `[${index}].id`, `Predicate '${result.predicate.id}' is declared more than once`),
      );
      return;
    }
    seen.add(result.predicate.id);
    predicates.push(result.predicate);
  });

  if (issues.length > 0) return { valid: false, predicates: null, issues };
  return { valid: true, predicates, issues: [] };
}

// ---------------------------------------------------------------------------
// Subject kinds and value shape
// ---------------------------------------------------------------------------

/**
 * Whether `type` may be the subject of a predicate declaring `subjectKinds`.
 *
 * `baseOf` walks the `extends` chain, so a predicate declared against `entity`
 * accepts `product extends entity` with no edit to the predicate. Without this
 * every pack would have to restate its predicates for each derived kind, which
 * is the drift N5's inheritance resolver exists to prevent.
 *
 * Depth is bounded because a corrupted chain must not hang a write path; the
 * inheritance resolver rejects cycles, and this is the second line.
 */
export function isSubjectKindAllowed(
  subjectKinds: readonly string[],
  type: string,
  baseOf?: (type: string) => string | undefined,
): boolean {
  if (subjectKinds.includes('*')) return true;
  let current: string | undefined = type;
  for (let depth = 0; current && depth < 16; depth += 1) {
    if (subjectKinds.includes(current)) return true;
    current = baseOf?.(current);
  }
  return false;
}

/**
 * Whether a field of `fieldType` can carry a predicate of `valueShape`.
 *
 * Today only `entity` is exercised: 4.1 attaches `predicate` to a relationship
 * field, whose value IS the object of the statement. The rest of the table is
 * stated because the `claim` kind (N11) carries `value` shaped per its
 * predicate, and leaving the mapping implicit is how the two halves drift.
 */
export function predicateValueShapeAcceptsFieldType(
  valueShape: PredicateValueShape,
  fieldType: string,
): boolean {
  switch (valueShape) {
    case 'entity':
      // `reference` is the legacy relationship alias.
      return fieldType === 'relationship' || fieldType === 'reference';
    case 'text':
      return fieldType === 'string' || fieldType === 'text';
    case 'quantity':
      return fieldType === 'number';
    case 'boolean-assessment':
      // A select, not a boolean: an assessment has to be able to say "partial"
      // and "unknown", and collapsing those to false is how a documented gap
      // becomes a recorded denial.
      return fieldType === 'select';
    case 'select':
      return fieldType === 'select' || fieldType === 'multiselect';
  }
}

// ---------------------------------------------------------------------------
// Qualifier values
// ---------------------------------------------------------------------------

export type PredicateQualifiersValidation =
  | { valid: true; issues: [] }
  | { valid: false; issues: PredicateIssue[] };

/**
 * Validate the qualifier bag on one statement against its predicate.
 *
 * `undefined` is treated as an empty bag rather than as "skip": a predicate
 * with a required qualifier must reject a statement that omits the bag
 * entirely, which is the acceptance gate in section 7 verbatim.
 */
export function validatePredicateQualifiers(
  predicate: PredicateDefinition,
  value: unknown,
): PredicateQualifiersValidation {
  const declarations = predicate.qualifiers ?? {};

  if (value !== undefined && value !== null && !isPlainObject(value)) {
    return {
      valid: false,
      issues: [
        issue('PREDICATE_QUALIFIERS_NOT_AN_OBJECT', '', `Qualifiers for '${predicate.id}' must be an object`),
      ],
    };
  }

  const bag: Record<string, unknown> = isPlainObject(value) ? value : {};
  const issues: PredicateIssue[] = [];

  for (const [name, declaration] of Object.entries(declarations)) {
    const qualifier = bag[name];
    if (qualifier === undefined || qualifier === null || qualifier === '') {
      if (declaration.required) {
        issues.push(
          issue(
            'PREDICATE_QUALIFIER_REQUIRED',
            name,
            `Predicate '${predicate.id}' requires qualifier '${name}'`,
          ),
        );
      }
      continue;
    }
    checkQualifierValue(predicate.id, name, declaration, qualifier, issues);
  }

  for (const name of Object.keys(bag)) {
    if (!(name in declarations)) {
      issues.push(
        issue(
          'PREDICATE_QUALIFIER_UNKNOWN',
          name,
          `Predicate '${predicate.id}' declares no qualifier '${name}'`,
        ),
      );
    }
  }

  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, issues: [] };
}

function checkQualifierValue(
  predicateId: string,
  name: string,
  declaration: PredicateQualifierDefinition,
  value: unknown,
  issues: PredicateIssue[],
): void {
  const wrongType = (expected: string) =>
    issues.push(
      issue(
        'PREDICATE_QUALIFIER_INVALID_TYPE',
        name,
        `Qualifier '${name}' of '${predicateId}' must be ${expected}`,
      ),
    );

  switch (declaration.type) {
    case 'string':
      if (typeof value !== 'string') wrongType('a string');
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) wrongType('a finite number');
      return;
    case 'boolean':
      if (typeof value !== 'boolean') wrongType('a boolean');
      return;
    case 'date':
      // A date qualifier is an ISO string on the wire; `Date` does not survive
      // the JSON round trip the field bag already goes through.
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        wrongType('an ISO date string');
      }
      return;
    case 'select':
      if (typeof value !== 'string') {
        wrongType('a string');
        return;
      }
      if (declaration.options && !declaration.options.includes(value)) {
        issues.push(
          issue(
            'PREDICATE_QUALIFIER_INVALID_OPTION',
            name,
            `Qualifier '${name}' of '${predicateId}' must be one of ${declaration.options.join(', ')}`,
          ),
        );
      }
      return;
    case 'relationship': {
      // Same shape a relationship field value uses, so a qualifier target is
      // resolved, rendered, and indexed by the code that already does that.
      const targets = Array.isArray(value) ? value : [value];
      if (targets.length === 0) {
        wrongType('a relationship reference with an itemId');
        return;
      }
      for (const target of targets) {
        const itemId = isPlainObject(target) ? target.itemId : undefined;
        if (typeof itemId !== 'string' || itemId.length === 0) {
          wrongType('a relationship reference with an itemId');
          return;
        }
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        wrongType('an array');
        return;
      }
      const itemType = declaration.itemType;
      if (!itemType) return;
      const matches = value.every(entry => typeof entry === itemType);
      if (!matches) wrongType(`an array of ${itemType}`);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Field declarations
// ---------------------------------------------------------------------------

export interface PredicateFieldDeclarationContext {
  /** Tracker type declaring the field: the subject of every statement it holds. */
  ownerType: string;
  /** The field's `type`, checked against the predicate's value shape. */
  fieldType: string;
  /** Resolve a tracker type's `extends` base, for {@link isSubjectKindAllowed}. */
  baseOf?: (type: string) => string | undefined;
}

/**
 * Validate a field's `predicate:` against the registry, at the moment the type
 * is declared rather than at the moment an item is written.
 *
 * This is deliberately separate from qualifier validation. A value-shape or
 * subject-kind mismatch is a defect in the SCHEMA, and reporting it on every
 * item write would point the author at data that is fine. `tracker_define_type`
 * and the schema editor call this; the write path calls
 * {@link validatePredicateQualifiers}.
 */
export function validatePredicateFieldDeclaration(
  predicateId: string,
  predicate: PredicateDefinition | undefined,
  context: PredicateFieldDeclarationContext,
): PredicateIssue[] {
  if (!predicate) {
    return [
      issue(
        'PREDICATE_UNKNOWN',
        'predicate',
        `No predicate '${predicateId}' is declared in this project's registry`,
      ),
    ];
  }

  const issues: PredicateIssue[] = [];

  if (!predicateValueShapeAcceptsFieldType(predicate.valueShape, context.fieldType)) {
    issues.push(
      issue(
        'PREDICATE_VALUE_SHAPE_MISMATCH',
        'predicate',
        `Predicate '${predicate.id}' has value shape '${predicate.valueShape}', which a '${context.fieldType}' field cannot carry`,
      ),
    );
  }

  if (!isSubjectKindAllowed(predicate.subjectKinds, context.ownerType, context.baseOf)) {
    issues.push(
      issue(
        'PREDICATE_SUBJECT_KIND_NOT_ALLOWED',
        'predicate',
        `Predicate '${predicate.id}' accepts subjects of ${predicate.subjectKinds.join(', ')}, not '${context.ownerType}'`,
      ),
    );
  }

  return issues;
}

/** The subset of a tracker type this check needs, so it stays free of the model. */
export interface PredicateDeclaringType {
  type: string;
  extends?: string;
  fields: ReadonlyArray<{ name: string; type: string; predicate?: string }>;
}

/**
 * Check every `predicate:` a type declares against the registry, at the moment
 * the type is authored.
 *
 * Issue paths are `fields.<name>.predicate`, so an authoring surface can point
 * at the row that is wrong rather than reporting "the schema is invalid".
 */
export function validateTrackerTypePredicateDeclarations(
  model: PredicateDeclaringType,
  lookup: (id: string) => PredicateDefinition | undefined,
  baseOf?: (type: string) => string | undefined,
): PredicateIssue[] {
  const issues: PredicateIssue[] = [];
  for (const field of model.fields) {
    if (!field.predicate) continue;
    const fieldIssues = validatePredicateFieldDeclaration(field.predicate, lookup(field.predicate), {
      ownerType: model.type,
      fieldType: field.type,
      baseOf,
    });
    for (const fieldIssue of fieldIssues) {
      issues.push({ ...fieldIssue, path: `fields.${field.name}.${fieldIssue.path}` });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function requireString(
  raw: Record<string, unknown>,
  key: string,
  issues: PredicateIssue[],
  pattern?: { re: RegExp; expectation: string },
): void {
  const value = raw[key];
  if (value === undefined || value === null) {
    issues.push(issue('PREDICATE_MISSING_FIELD', key, `'${key}' is required`));
    return;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(issue('PREDICATE_INVALID_FIELD', key, `'${key}' must be a non-empty string`));
    return;
  }
  if (pattern && !pattern.re.test(value)) {
    issues.push(issue('PREDICATE_INVALID_FIELD', key, `'${key}' ${pattern.expectation}`));
  }
}

function checkOptionalString(
  raw: Record<string, unknown>,
  key: string,
  issues: PredicateIssue[],
  pathPrefix?: string,
): void {
  const value = raw[key];
  if (value === undefined) return;
  if (typeof value !== 'string') {
    issues.push(
      issue(
        'PREDICATE_INVALID_FIELD',
        pathPrefix ? `${pathPrefix}.${key}` : key,
        `'${key}' must be a string when present`,
      ),
    );
  }
}

function requireEnum<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  issues: PredicateIssue[],
): void {
  const value = raw[key];
  if (value === undefined || value === null) {
    issues.push(issue('PREDICATE_MISSING_FIELD', key, `'${key}' is required`));
    return;
  }
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    issues.push(
      issue(
        'PREDICATE_INVALID_FIELD',
        key,
        `'${key}' must be one of ${allowed.join(', ')}`,
      ),
    );
  }
}
