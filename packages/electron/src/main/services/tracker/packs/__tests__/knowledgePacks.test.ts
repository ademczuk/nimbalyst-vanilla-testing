// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  KNOWLEDGE_PACKS,
  KNOWLEDGE_CORE_PACK,
  KNOWLEDGE_SOFTWARE_PACK,
} from '../knowledgePacks';
import {
  parseTrackerYAML,
  parsePredicateRegistryYAML,
  type TrackerDataModel,
} from '@nimbalyst/tracker-schema';

/**
 * A pack is data that gets written into a user's project. A malformed YAML, a
 * relationship field aimed at a type the pack never ships, or a predicate the
 * registry rejects would all surface as a failed install on their machine, with
 * the project half-populated -- so they fail here instead.
 */

describe('knowledge packs', () => {
  const allPackTypes = new Set(
    KNOWLEDGE_PACKS.flatMap(pack => pack.types.map(t => t.type)),
  );
  // Types a pack may target without shipping them: the N7 evidence builtins and
  // the wildcard.
  const BUILTIN_TARGETS = new Set(['source', 'capture', 'citation', 'decision']);

  const parsed = new Map<string, TrackerDataModel>();
  for (const pack of KNOWLEDGE_PACKS) {
    for (const { type, yaml } of pack.types) {
      parsed.set(type, parseTrackerYAML(yaml));
    }
  }

  it.each(KNOWLEDGE_PACKS.flatMap(p => p.types.map(t => [p.id, t.type] as const)))(
    '%s ships %s with a matching declared type',
    (_packId, type) => {
      expect(parsed.get(type)?.type).toBe(type);
    },
  );

  it('aims every relationship field at a type the install will produce', () => {
    const dangling: string[] = [];
    for (const [type, model] of parsed) {
      for (const field of model.fields) {
        const targets = field.targetTrackerTypes;
        if (!Array.isArray(targets)) continue; // '*' targets anything
        for (const target of targets) {
          if (allPackTypes.has(target) || BUILTIN_TARGETS.has(target)) continue;
          dangling.push(`${type}.${field.name} -> ${target}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it('orders knowledge-core so a type is installed before anything targets it', () => {
    // `question` and `finding` point at each other, so this checks the rest.
    const order = KNOWLEDGE_CORE_PACK.types.map(t => t.type);
    expect(order.indexOf('entity')).toBeLessThan(order.indexOf('claim'));
    expect(order.indexOf('question')).toBeLessThan(order.indexOf('finding'));
  });

  it('validates the knowledge-software predicate registry', () => {
    const result = parsePredicateRegistryYAML(KNOWLEDGE_SOFTWARE_PACK.predicatesYaml!);
    expect(result.valid ? [] : result.issues).toEqual([]);
  });

  it('declares software predicates against entity so derived kinds inherit them', () => {
    const result = parsePredicateRegistryYAML(KNOWLEDGE_SOFTWARE_PACK.predicatesYaml!);
    if (!result.valid) throw new Error('registry did not parse');
    // Narrowing a subject kind here is a destructive registry change that would
    // invalidate every statement about a kind that used to qualify, so the
    // breadth is the contract, not an accident.
    for (const predicate of result.predicates) {
      expect(predicate.subjectKinds).toEqual(['entity']);
    }
  });
});
