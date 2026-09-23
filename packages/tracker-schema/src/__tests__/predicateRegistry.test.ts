// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  TrackerDataModelRegistry,
  type TrackerDataModel,
} from '../TrackerDataModel.js';
import {
  isSubjectKindAllowed,
  predicateValueShapeAcceptsFieldType,
  validatePredicateDefinition,
  validatePredicateQualifiers,
  validatePredicateRegistry,
  validateTrackerTypePredicateDeclarations,
  type PredicateDefinition,
} from '../predicateRegistry.js';
import { classifyPredicateRegistryChanges } from '../trackerPredicateRegistryChangeClassifier.js';
import { parsePredicateRegistryYAML, serializePredicateRegistryYAML } from '../YAMLParser.js';
import { validateCitationLocator } from '../citationLocator.js';

/** Contract 4.1's example, verbatim. Anything that breaks this breaks the contract. */
const INTEGRATES_WITH: PredicateDefinition = {
  id: 'integrates-with',
  label: 'integrates with',
  inverseLabel: 'is integrated by',
  subjectKinds: ['product'],
  valueShape: 'entity',
  direction: 'directed',
  transitive: false,
  qualifiers: {
    via: { type: 'relationship', targetTrackerTypes: ['connector'], required: true },
    operations: { type: 'array', itemType: 'string', required: true },
    authentication: { type: 'string' },
    testedClientVersion: { type: 'string' },
  },
};

function codes(issues: ReadonlyArray<{ code: string }>): string[] {
  return issues.map(issue => issue.code);
}

function productType(overrides: Partial<TrackerDataModel> = {}): TrackerDataModel {
  return {
    type: 'product',
    displayName: 'Product',
    displayNamePlural: 'Products',
    icon: 'inventory_2',
    color: '#888888',
    modes: { inline: true, fullDocument: true },
    idPrefix: 'PRD',
    idFormat: 'ulid',
    fields: [
      {
        name: 'integrations',
        type: 'relationship',
        relationshipTypeKey: 'integrates-with',
        predicate: 'integrates-with',
        targetTrackerTypes: ['product'],
        multiValue: true,
      },
    ],
    ...overrides,
  };
}

describe('predicate declarations', () => {
  it('accepts contract 4.1 verbatim and round-trips through the local YAML copy', () => {
    expect(validatePredicateDefinition(INTEGRATES_WITH).valid).toBe(true);

    const parsed = parsePredicateRegistryYAML(serializePredicateRegistryYAML([INTEGRATES_WITH]));
    expect(parsed.valid).toBe(true);
    expect(parsed.predicates).toEqual([INTEGRATES_WITH]);
  });

  it('is strict in both directions and collects every issue in one pass', () => {
    const result = validatePredicateDefinition({
      id: 'Integrates With',
      label: 'integrates with',
      subjectKinds: [],
      valueShape: 'thing',
      direction: 'directed',
      inversLabel: 'typo',
      qualifiers: {
        via: { type: 'relationship', targetTrackerType: ['connector'] },
        mode: { type: 'select' },
      },
    });

    expect(result.valid).toBe(false);
    expect(codes(result.issues).sort()).toEqual([
      'PREDICATE_INVALID_FIELD', // id grammar
      'PREDICATE_INVALID_FIELD', // empty subjectKinds
      'PREDICATE_INVALID_FIELD', // unknown valueShape
      'PREDICATE_MISSING_FIELD', // select with no options
      'PREDICATE_UNKNOWN_FIELD', // inversLabel
      'PREDICATE_UNKNOWN_FIELD', // targetTrackerType
    ].sort());
  });

  it('rejects a property on the wrong qualifier type', () => {
    const result = validatePredicateDefinition({
      ...INTEGRATES_WITH,
      qualifiers: { operations: { type: 'string', itemType: 'string' } },
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: 'PREDICATE_INVALID_FIELD',
      path: 'qualifiers.operations.itemType',
    });
  });

  it('reports a duplicate id on the later entry rather than letting one win silently', () => {
    const result = validatePredicateRegistry([INTEGRATES_WITH, { ...INTEGRATES_WITH, label: 'other' }]);
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'PREDICATE_DUPLICATE_ID', path: '[1].id' }),
    ]);
  });

  it('reads an empty file as an empty registry, not a failure', () => {
    expect(parsePredicateRegistryYAML('')).toEqual({ valid: true, predicates: [], issues: [] });
  });
});

describe('subject kinds and value shape', () => {
  it('accepts a derived type against a base listed in subjectKinds', () => {
    const baseOf = (type: string) => (type === 'product' ? 'entity' : undefined);
    expect(isSubjectKindAllowed(['entity'], 'product', baseOf)).toBe(true);
    expect(isSubjectKindAllowed(['entity'], 'product')).toBe(false);
    expect(isSubjectKindAllowed(['*'], 'anything')).toBe(true);
    expect(isSubjectKindAllowed(['capability'], 'product', baseOf)).toBe(false);
  });

  it('terminates on a cyclic extends chain instead of hanging a write path', () => {
    const cyclic = (type: string) => (type === 'a' ? 'b' : 'a');
    expect(isSubjectKindAllowed(['nope'], 'a', cyclic)).toBe(false);
  });

  it('maps each value shape to the field types that can carry it', () => {
    expect(predicateValueShapeAcceptsFieldType('entity', 'relationship')).toBe(true);
    expect(predicateValueShapeAcceptsFieldType('entity', 'reference')).toBe(true);
    expect(predicateValueShapeAcceptsFieldType('entity', 'string')).toBe(false);
    // An assessment must be able to say "partial" and "unknown".
    expect(predicateValueShapeAcceptsFieldType('boolean-assessment', 'boolean')).toBe(false);
    expect(predicateValueShapeAcceptsFieldType('boolean-assessment', 'select')).toBe(true);
    expect(predicateValueShapeAcceptsFieldType('quantity', 'number')).toBe(true);
  });

  it('rejects a field declaration whose type cannot carry the predicate', () => {
    const model = productType({
      fields: [{ name: 'summary', type: 'text', predicate: 'integrates-with' }],
    });
    const issues = validateTrackerTypePredicateDeclarations(model, () => INTEGRATES_WITH);
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'PREDICATE_VALUE_SHAPE_MISMATCH',
        path: 'fields.summary.predicate',
      }),
    ]);
  });

  it('reports an undeclared predicate on the field that names it', () => {
    const issues = validateTrackerTypePredicateDeclarations(productType(), () => undefined);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'PREDICATE_UNKNOWN', path: 'fields.integrations.predicate' }),
    ]);
  });
});

describe('qualifier values', () => {
  it('rejects an omitted bag when a qualifier is required', () => {
    const result = validatePredicateQualifiers(INTEGRATES_WITH, undefined);
    expect(result.valid).toBe(false);
    expect(codes(result.issues)).toEqual(['PREDICATE_QUALIFIER_REQUIRED', 'PREDICATE_QUALIFIER_REQUIRED']);
  });

  it('accepts a complete bag and rejects an unknown qualifier', () => {
    const complete = {
      via: { itemId: 'itm_connector' },
      operations: ['read', 'write'],
      authentication: 'oauth',
    };
    expect(validatePredicateQualifiers(INTEGRATES_WITH, complete).valid).toBe(true);

    const typo = validatePredicateQualifiers(INTEGRATES_WITH, { ...complete, operation: ['read'] });
    expect(typo.issues).toEqual([
      expect.objectContaining({ code: 'PREDICATE_QUALIFIER_UNKNOWN', path: 'operation' }),
    ]);
  });

  it('checks the declared value type, not merely presence', () => {
    const result = validatePredicateQualifiers(INTEGRATES_WITH, {
      via: { notAnItem: true },
      operations: ['read', 7],
    });
    expect(codes(result.issues)).toEqual([
      'PREDICATE_QUALIFIER_INVALID_TYPE',
      'PREDICATE_QUALIFIER_INVALID_TYPE',
    ]);
  });

  it('rejects a select value outside its options', () => {
    const predicate: PredicateDefinition = {
      id: 'supports-capability',
      label: 'supports',
      subjectKinds: ['*'],
      valueShape: 'entity',
      direction: 'directed',
      qualifiers: { support: { type: 'select', options: ['yes', 'partial', 'no', 'unknown'] } },
    };
    expect(validatePredicateQualifiers(predicate, { support: 'partial' }).valid).toBe(true);
    expect(codes(validatePredicateQualifiers(predicate, { support: 'maybe' }).issues))
      .toEqual(['PREDICATE_QUALIFIER_INVALID_OPTION']);
  });
});

describe('write-time validation through the registry', () => {
  function registryWithPredicate(): TrackerDataModelRegistry {
    const registry = new TrackerDataModelRegistry();
    registry.register(productType());
    registry.setPredicates([INTEGRATES_WITH]);
    return registry;
  }

  it('rejects a statement missing a required qualifier, with the shared code', () => {
    const registry = registryWithPredicate();
    const result = registry.validate('product', {
      integrations: [{ itemId: 'itm_notion', qualifiers: { operations: ['read'] } }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'PREDICATE_QUALIFIER_REQUIRED',
        field: 'integrations[0].qualifiers.via',
      }),
    ]);
  });

  it('accepts a complete statement', () => {
    const registry = registryWithPredicate();
    const result = registry.validate('product', {
      integrations: [{
        itemId: 'itm_notion',
        qualifiers: { via: { itemId: 'itm_webhook' }, operations: ['read', 'write'] },
      }],
    });
    expect(result.valid).toBe(true);
  });

  it('reports an unknown predicate once for the field, not once per entry', () => {
    const registry = new TrackerDataModelRegistry();
    registry.register(productType());
    const result = registry.validate('product', {
      integrations: [{ itemId: 'a' }, { itemId: 'b' }],
    });
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'PREDICATE_UNKNOWN', field: 'integrations' }),
    ]);
  });

  it('rejects statements once the registry narrows subjectKinds under a valid field', () => {
    const registry = registryWithPredicate();
    const statement = {
      integrations: [{
        itemId: 'itm_notion',
        qualifiers: { via: { itemId: 'itm_webhook' }, operations: ['read'] },
      }],
    };
    expect(registry.validate('product', statement).valid).toBe(true);

    registry.setPredicates([{ ...INTEGRATES_WITH, subjectKinds: ['capability'] }]);
    expect(registry.validate('product', statement).errors).toEqual([
      expect.objectContaining({ code: 'PREDICATE_SUBJECT_KIND_NOT_ALLOWED' }),
    ]);
  });

  it('empties the registry on workspace switch so one project cannot validate another', () => {
    const registry = registryWithPredicate();
    expect(registry.getPredicate('integrates-with')).toBeDefined();
    registry.clearWorkspaceSchemas();
    expect(registry.getPredicate('integrates-with')).toBeUndefined();
  });
});

describe('registry change classification', () => {
  const classify = (next: PredicateDefinition[]) =>
    classifyPredicateRegistryChanges([INTEGRATES_WITH], next);

  it('reports no change for an identical registry', () => {
    expect(classify([INTEGRATES_WITH]).classification).toBe('none');
  });

  it('treats a label change as nothing at all', () => {
    expect(classify([{ ...INTEGRATES_WITH, label: 'talks to' }]).classification).toBe('none');
  });

  it('classifies the three cases contract 4.1 names as destructive', () => {
    expect(classify([]).changes).toEqual([
      expect.objectContaining({ kind: 'predicate-removed', predicateId: 'integrates-with' }),
    ]);

    expect(classify([{ ...INTEGRATES_WITH, subjectKinds: [] }]).changes).toEqual([
      expect.objectContaining({ kind: 'subject-kinds-narrowed' }),
    ]);

    const required = classify([{
      ...INTEGRATES_WITH,
      qualifiers: {
        ...INTEGRATES_WITH.qualifiers,
        authentication: { type: 'string', required: true },
      },
    }]);
    expect(required.classification).toBe('destructive');
    expect(required.changes).toEqual([
      expect.objectContaining({ kind: 'qualifier-made-required', qualifierName: 'authentication' }),
    ]);
  });

  it('classifies an optional addition, a widening, and a relaxation as additive', () => {
    expect(classify([{ ...INTEGRATES_WITH, subjectKinds: ['product', 'capability'] }]).classification)
      .toBe('additive');

    const added = classify([{
      ...INTEGRATES_WITH,
      qualifiers: { ...INTEGRATES_WITH.qualifiers, notes: { type: 'string' } },
    }]);
    expect(added.classification).toBe('additive');
    expect(added.changes).toEqual([
      expect.objectContaining({ kind: 'qualifier-added', qualifierName: 'notes' }),
    ]);

    const relaxed = classify([{
      ...INTEGRATES_WITH,
      qualifiers: { ...INTEGRATES_WITH.qualifiers, operations: { type: 'array', itemType: 'string' } },
    }]);
    expect(relaxed.classification).toBe('additive');
  });

  it('classifies a NEW required qualifier as destructive, not as an addition', () => {
    const result = classify([{
      ...INTEGRATES_WITH,
      qualifiers: { ...INTEGRATES_WITH.qualifiers, tier: { type: 'string', required: true } },
    }]);
    expect(result.classification).toBe('destructive');
  });

  it('classifies an unprovable qualifier diff as destructive by default', () => {
    const result = classify([{
      ...INTEGRATES_WITH,
      qualifiers: {
        ...INTEGRATES_WITH.qualifiers,
        via: { type: 'relationship', targetTrackerTypes: ['connector', 'product'], required: true },
      },
    }]);
    expect(result.classification).toBe('destructive');
    expect(result.changes).toEqual([
      expect.objectContaining({ kind: 'qualifier-definition-changed', qualifierName: 'via' }),
    ]);
  });

  it('classifies a direction flip as destructive: every stored edge re-reads', () => {
    expect(classify([{ ...INTEGRATES_WITH, direction: 'symmetric' }]).classification)
      .toBe('destructive');
  });
});

describe('scope-node is restricted to scopes that assign a revision UUID', () => {
  const base = {
    selectorType: 'scope-node' as const,
    version: 1 as const,
    nodeId: 'n5-extends-contract',
    revisionId: '9f2c1d4a-7b31-4e59-a0c8-5d6e2f1b3a77',
  };

  it('accepts the scopes that carry contract 4.2 revision identity', () => {
    for (const scopeId of ['me:', 'team:proj_123', 'org:org_9']) {
      expect(validateCitationLocator({ ...base, scopeId }).valid).toBe(true);
    }
  });

  it('rejects a public scope, whose revisions are opaque publication strings', () => {
    const result = validateCitationLocator({ ...base, scopeId: 'public:testedknowhow' });
    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'LOCATOR_SCOPE_NODE_UNVERSIONED_SCOPE', path: 'scopeId' }),
    ]);
  });

  it('reports a malformed scope id distinctly from a well-formed unversioned one', () => {
    const result = validateCitationLocator({ ...base, scopeId: 'nonsense' });
    expect(codes(result.issues)).toEqual(['LOCATOR_INVALID_FIELD']);
  });
});

/**
 * `predicate-ref`: the verb carried as DATA rather than declared on the field.
 *
 * The `claim` kind needs this because its verb varies per item, so it cannot
 * come from the field declaration the way a typed entity's `integrations`
 * field does. Before it existed, `claim.predicate` was an unchecked string.
 */
describe('predicate-ref field validation', () => {
  const CLAIM_MODEL: TrackerDataModel = {
    type: 'claim',
    displayName: 'Claim',
    displayNamePlural: 'Claims',
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'predicate', type: 'predicate-ref' },
    ],
  } as TrackerDataModel;

  const INTEGRATES: PredicateDefinition = {
    id: 'integrates-with',
    label: 'integrates with',
    subjectKinds: ['entity'],
    valueShape: 'entity',
    direction: 'directed',
  };

  function registryWith(predicates: PredicateDefinition[]): TrackerDataModelRegistry {
    const registry = new TrackerDataModelRegistry();
    registry.register(CLAIM_MODEL);
    registry.setPredicates(predicates);
    return registry;
  }

  it('accepts a verb the registry declares', () => {
    const result = registryWith([INTEGRATES]).validate('claim', {
      title: 'A integrates with B',
      predicate: 'integrates-with',
    });
    expect(result.errors).toEqual([]);
  });

  it('rejects a typo with the same code every other surface reports', () => {
    const result = registryWith([INTEGRATES]).validate('claim', {
      title: 'A integrates with B',
      predicate: 'integrates-wth',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'PREDICATE_UNKNOWN', field: 'predicate' }),
    ]);
  });

  it('accepts anything while the project has no registry at all', () => {
    // A project that has not installed a predicate pack has an empty registry.
    // Rejecting every verb there would make the claim kind unusable before the
    // pack lands, rather than merely unvalidated.
    const result = registryWith([]).validate('claim', {
      title: 'A integrates with B',
      predicate: 'anything-at-all',
    });
    expect(result.errors).toEqual([]);
  });

  it('rejects a non-string verb', () => {
    const result = registryWith([INTEGRATES]).validate('claim', { title: 'x', predicate: 42 });
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'PREDICATE_REF_NOT_A_STRING' }),
    ]);
  });
});
