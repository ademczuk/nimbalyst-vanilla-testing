---
name: knowledge-graph
description: Set up and write a knowledge graph in Nimbalyst trackers -- entities, claims, questions, findings, investigations, and the predicates that connect them. Use when the user wants a team wiki, a knowledge base, to record what is known about products/systems/decisions, or to add statements, questions, or findings to an existing graph.
---

# Knowledge graph

A knowledge graph here is ordinary tracker data with a fixed vocabulary:

- **Kinds are tracker types.** `entity`, `claim`, `question`, `finding`, `investigation`.
- **Pages are tracker items.** Each item's body is a collaborative document; write prose there.
- **Statements are claim items.** `subject` (an entity) + `predicate` (a verb from the registry) + `object` (an entity) or `valueText`.
- The web console wiki reads these types directly. Its statements, backlinks, and question views depend on the names below, so the vocabulary is shared across every project that uses it.

The canonical definitions are in `references/` next to this file. They are the source of truth; copy them, do not paraphrase them.

| File | Kind |
| --- | --- |
| `references/entity.yaml` | Anything statements are about. Domains are values of `kind`. |
| `references/claim.yaml` | One assertion under stated conditions. |
| `references/question.yaml` | A goal with constraints, an owner, and a current position. |
| `references/finding.yaml` | A scoped answer resting on exact claims. |
| `references/investigation.yaml` | One attempt at a question, including failed ones. |
| `references/predicates.yaml` | The verb registry for `claim.predicate`. |

## Invariants (do not rename or repurpose)

- Kind ids: `entity`, `claim`, `question`, `finding`, `investigation`.
- `claim.subject` and `claim.object` are relationships to `entity`. `claim.predicate` is a `predicate-ref` whose value is a predicate `id` from the registry. `claim.basis` is one of `documented`, `observed`, `decision`, `inference`.
- `question.owner`, `question.position`, `question.positionAsOf`, `question.positionState`, `question.decidedBy`, `question.decidedAt` carry accountability. `question.subjects` targets `entity`; `question.answers` targets `finding`.
- `finding.question` targets `question`; `finding.claims` targets `claim`. `investigation.question` targets `question`.
- The wiki hierarchy reads `entity.kind: area`, `entity.parent` (targets `entity`), and `question.parent` (targets `question`).
- Predicate ids and their `label` / `inverseLabel` are what the wiki prints. Do not change an existing id.

## Setup

1. Call `tracker_list_types` and note which of the five kinds already exist and who owns them (`personal` or `team:<name>`).
2. Decide sharing. If the project is shared with a team, define the kinds with `sharing: team` so the web console and teammates see them. Otherwise leave `sharing: personal`. Use the same sharing for all five.
3. For each missing kind, read its reference file and call `tracker_define_type` with `schema` set to the YAML converted to a JSON object (drop comments; change only `sharing`).
4. Read the project's current registry from `.nimbalyst/predicates.yaml` at the workspace root (for a team project this is the local copy of the team's registry; a missing file means an empty registry). Merge in every predicate from `references/predicates.yaml` whose `id` is not already there, keep all existing ones unchanged, and call `tracker_define_type` with `predicates` set to the merged array. The call replaces the whole registry, so never send only the reference list. An existing predicate with the same `id` but a different definition is a conflict: keep the existing one and report it.
5. Idempotence: if a kind already exists, compare it to the reference. Missing fields or options may be added with a `schema` + `overwrite: true` that keeps every existing field. Never remove, rename, or change the type of an existing field or option, never pass `confirmDestructive` on your own, and never overwrite a kind that differs in an incompatible way. Report each conflict to the user with the field names and stop for that kind.
6. Switching an existing personal kind to team needs `promoteExistingItems: true`; ask the user first.

## Hierarchy

The wiki's tree comes from links between items, not tracker folders.

- A top-level area is an entity with `kind: area` and no `parent`.
- Subareas (also `kind: area`) and pages (any other entity) set `parent` to the entity they sit under.
- Questions appear under the entities in their `subjects`. A sub-question sets `parent` to the question it helps answer.
- Never create a cycle: before setting `parent`, walk up from the new parent and make sure you do not reach the item itself.
- Keep it shallow: an area, a subarea, then pages. Use claims, not deeper nesting, to relate pages to each other.

## Extending

- Domain distinctions go in `entity.kind`. To add a domain (a service, a dataset, a vendor), add options to `entity.kind`, and add optional fields to `entity` if that domain needs them. Keep them on `entity` so every relationship and predicate that targets `entity` still accepts them.
- Derived kinds (`extends: entity`) are not supported yet; `tracker_define_type` rejects them. Do not define one.
- Create a new standalone kind only when the thing is not something statements are made about and has genuinely different fields; relationships that target `entity` will not accept it.
- Add fields and options; never repurpose an existing one to mean something else.
- A new verb goes in the predicate registry with `id`, `label`, `inverseLabel`, `subjectKinds`, `valueShape` (`entity`, `text`, `boolean-assessment`, `quantity`, or `select`), `direction` (`directed` or `symmetric`; required), and the qualifiers a reader needs to act on it. Use `subjectKinds: [entity]`.

## Writing the graph

- **One assertion per claim.** If the sentence has "and", it is two claims. Title the claim as the plain sentence ("Product A exports CSV").
- **Basis is a field, not a trust score.** `documented` = someone's docs say so; `observed` = seen or tested; `decision` = we chose it; `inference` = reasoned, not seen. Never invent a confidence number.
- **A documentation claim is never relabelled as tested.** When a test confirms it, add a separate `observed` claim that cites the test, and leave the documented one as it was.
- **State when it holds** in `applicability` (versions, plans, platforms) and put sources in `citations`.
- **Changing a claim** means a new claim with `supersedes` set and the old one moved to `superseded`, not an in-place rewrite of what was asserted.
- **Questions carry a current position.** Update `position`, `positionAsOf`, and `positionState` as the answer firms up. `status` tracks work; `positionState` tracks acceptance -- `answered` does not mean `accepted`. Set `owner`; set `decidedBy`/`decidedAt` only when someone with authority accepts the position.
- **Findings cite exact claims** in `claims` and say where the answer holds (`scope`) and where it does not (`limitations`). Link the finding back from `question.answers`.
- **Investigations are recorded even when inconclusive.** Put versions and config in `environment`; link findings you reused in `reusedFindings`.
- Search for an existing entity (title and `aliases`) before creating one. Add alternate names to `aliases` instead of creating duplicates.

## References in bodies

Link items from any body with the issue key as label and URL:

- `[KEY](nimbalyst://KEY)` -- inline link.
- `[KEY](nimbalyst://KEY "view=card")` -- embedded card (on its own line).
- `[ENTITY-KEY](nimbalyst://ENTITY-KEY "view=statements")` -- embedded list of the claims about that entity.

Only link keys you created or looked up. A typical entity page: a short summary, then a `view=statements` embed of itself, then cards for the findings and questions that concern it.
