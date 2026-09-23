/**
 * Knowledge packs: bundles of tracker types plus predicates that a project
 * installs as a set (knowledge-scopes master plan section 3, N11).
 *
 * A pack is DATA, not code. The YAML beside this module is the source of truth
 * and the installer's job is to put it where the existing schema machinery
 * already looks -- `.nimbalyst/trackers/*.yaml` and `.nimbalyst/predicates.yaml`.
 * The packs currently declare personal sharing. Team-owned installation must
 * wait for the predicate registry's outbound room publication (C4); silently
 * claiming team ownership before that would leave each member with a different
 * vocabulary. Nothing here is a second schema pipeline.
 *
 * Deliberately NOT bundled as builtins. A builtin type exists in every
 * workspace whether or not anyone wanted it, and a knowledge graph is opt-in by
 * construction: the pilot's `knowledge-core` is useful to a project doing
 * knowledge work and pure clutter in the type picker everywhere else. Keeping
 * packs out of `ModelLoader`'s builtin list also keeps them out of the eager
 * renderer bundle, which the three N7 evidence builtins already cost 1,978
 * gzip bytes for.
 *
 * It lives in the main process rather than in `runtime` because installing is a
 * filesystem operation and the renderer never needs the raw YAML -- it sees
 * resolved models through the registry like any other type. Keeping it here
 * also keeps the pack text out of every bundle that imports the runtime barrel.
 *
 * This module imports nothing but the raw YAML, so a test can read a pack
 * without starting a workspace.
 */

import entityYaml from './knowledge-core/entity.yaml?raw';
import claimYaml from './knowledge-core/claim.yaml?raw';
import questionYaml from './knowledge-core/question.yaml?raw';
import findingYaml from './knowledge-core/finding.yaml?raw';
import investigationYaml from './knowledge-core/investigation.yaml?raw';
import softwarePredicatesYaml from './knowledge-software/predicates.yaml?raw';

export interface KnowledgePackType {
  /** Tracker type id; must match the `type:` in the YAML. */
  type: string;
  yaml: string;
}

export interface KnowledgePack {
  id: string;
  label: string;
  description: string;
  /**
   * Install order. A type whose relationship fields target another type in the
   * same pack comes after it, so a partial install never leaves a field
   * pointing at a type that does not exist yet.
   */
  types: KnowledgePackType[];
  /** Predicate registry YAML contributed by this pack, if any. */
  predicatesYaml?: string;
}

/**
 * The pilot's base pack.
 *
 * `source`, `capture` and `citation` are NOT here: they shipped as builtins
 * with N7 because the citation field type needs them present to render a chip,
 * and a field type that only works after a pack install is a field type that
 * breaks in most workspaces. The evidence kinds are infrastructure; the kinds
 * below are the graph.
 */
export const KNOWLEDGE_CORE_PACK: KnowledgePack = {
  id: 'knowledge-core',
  label: 'Knowledge core',
  description:
    'Entities, claims, questions, findings and investigations: the kinds every knowledge scope is built from.',
  types: [
    { type: 'entity', yaml: entityYaml },
    { type: 'claim', yaml: claimYaml },
    { type: 'question', yaml: questionYaml },
    // `finding` before `question` would leave `question.answers` dangling, and
    // `finding.question` points back, so one of the two orders has to be wrong
    // for one field. Questions first: a finding with no question is the odd
    // case, a question with no answer yet is the normal one.
    { type: 'finding', yaml: findingYaml },
    { type: 'investigation', yaml: investigationYaml },
  ],
};

/**
 * The software-domain pack. Predicates only for now: its `product`,
 * `capability`, `connector` and `configured-target` types are `extends: entity`
 * declarations, and a derived type on disk is not resolvable yet (N5 left the
 * workspace YAML loader on the full-model parser). Until then `entity.kind`
 * carries the same distinction as data.
 */
export const KNOWLEDGE_SOFTWARE_PACK: KnowledgePack = {
  id: 'knowledge-software',
  label: 'Knowledge: software',
  description:
    'Predicates for describing software: integration, protocol, provenance, composition, formats and capability support.',
  types: [],
  predicatesYaml: softwarePredicatesYaml,
};

export const KNOWLEDGE_PACKS: readonly KnowledgePack[] = [
  KNOWLEDGE_CORE_PACK,
  KNOWLEDGE_SOFTWARE_PACK,
];

export function getKnowledgePack(id: string): KnowledgePack | undefined {
  return KNOWLEDGE_PACKS.find(pack => pack.id === id);
}
