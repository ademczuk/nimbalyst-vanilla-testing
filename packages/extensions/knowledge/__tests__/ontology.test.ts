// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { parsePredicateRegistryYAML, parseTrackerYAML } from '@nimbalyst/tracker-schema';

// The skill's reference files are the canonical knowledge ontology. The web
// console wiki reads these kind ids and field names, and agents pass the files
// to `tracker_define_type` as-is, so they must parse with the runtime parser
// and every relationship must land on a kind the ontology itself defines.
const REFERENCES = path.resolve(__dirname, '../claude-plugin/skills/knowledge-graph/references');
const KINDS = ['entity', 'claim', 'question', 'finding', 'investigation'];

const read = (name: string) => readFileSync(path.join(REFERENCES, name), 'utf-8');
const models = KINDS.map((kind) => parseTrackerYAML(read(`${kind}.yaml`)));
const field = (type: string, name: string) =>
  models.find((m) => m.type === type)?.fields.find((f) => f.name === name);

describe('knowledge ontology references', () => {
  it('defines each kind under its file name and targets only defined kinds', () => {
    expect(models.map((m) => m.type)).toEqual(KINDS);
    for (const model of models) {
      for (const f of model.fields.filter((f) => f.type === 'relationship')) {
        expect(f.targetTrackerTypes?.length, `${model.type}.${f.name}`).toBeGreaterThan(0);
        for (const target of f.targetTrackerTypes ?? []) {
          expect(KINDS, `${model.type}.${f.name} -> ${target}`).toContain(target);
        }
      }
    }
  });

  it('keeps the fields the wiki reads', () => {
    expect(field('claim', 'subject')?.targetTrackerTypes).toEqual(['entity']);
    expect(field('claim', 'predicate')?.type).toBe('predicate-ref');
    expect(field('claim', 'basis')?.options?.map((o) => o.value)).toEqual([
      'documented', 'observed', 'decision', 'inference',
    ]);
    expect(field('question', 'owner')?.type).toBe('user');
    expect(field('question', 'position')?.type).toBe('text');
    expect(field('question', 'positionState')?.type).toBe('select');
    // Wiki hierarchy: areas -> subareas -> pages, built from links.
    expect(field('entity', 'kind')?.options?.map((o) => o.value)).toContain('area');
    expect(field('entity', 'parent')).toMatchObject({
      type: 'relationship', targetTrackerTypes: ['entity'], multiValue: false,
    });
    expect(field('question', 'parent')).toMatchObject({
      type: 'relationship', targetTrackerTypes: ['question'], multiValue: false,
    });
  });

  it('ships a valid predicate registry whose subjects and targets are defined kinds', () => {
    const result = parsePredicateRegistryYAML(read('predicates.yaml'));
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    for (const predicate of result.predicates ?? []) {
      expect(predicate.inverseLabel, predicate.id).toBeTruthy();
      for (const kind of predicate.subjectKinds) expect(KINDS).toContain(kind);
      for (const qualifier of Object.values(predicate.qualifiers ?? {})) {
        for (const target of qualifier.targetTrackerTypes ?? []) expect(KINDS).toContain(target);
      }
    }
  });
});
