---
name: knowledge-setup
description: Initialize or repair a project's knowledge graph in Nimbalyst trackers -- define the entity, claim, question, finding, and investigation kinds, merge the predicate registry, create the wiki home page, and install the "How we write this wiki" guide page. Safe to re-run; it never overwrites or deletes. Use when the user wants to start a team wiki or knowledge base, or to check that an existing one is set up.
---

# Knowledge setup

<!-- remote-only
On the wiki server, `tracker_define_type` and the other tools act on the team project `wiki_status` resolved, and connecting a repository (`wiki_bind_repo` or `wiki_create_project`) already runs this setup there. Use this skill only when the user asks to check or repair a wiki's setup.
-->

Sets up everything the `knowledge-graph` skill writes into. Every step checks what exists first, adds only what is missing, and reports each step as **created**, **already present**, or **conflict**. Never delete, rename, or overwrite anything; stop and ask when a step would.

The ontology definitions are in `../knowledge-graph/references/` (the five kind files and `predicates.yaml`). The base wiki guide is `references/wiki-guide.md` next to this file. Copy them; do not paraphrase them.

## 1. Kinds

1. Call `tracker_list_types` and note which of `entity`, `claim`, `question`, `finding`, `investigation` already exist and who owns them (`personal` or `team:<name>`).
<!-- desktop-only -->
2. Decide sharing. If the project is shared with a team, define the kinds with `sharing: team` so the web console and teammates see them. Otherwise leave `sharing: personal`. Use the same sharing for all five.
3. For each missing kind, read its reference file and call `tracker_define_type` with `schema` set to the YAML converted to a JSON object (drop comments; change only `sharing`).
<!-- /desktop-only -->
<!-- remote-only
2. Sharing: nothing to decide. The server stores every kind as a team kind whatever `sharing` says.
3. For each missing kind, read its reference file and call `tracker_define_type` with `schema` set to the YAML converted to a JSON object (drop comments; change nothing else).
-->
4. If a kind already exists, compare it to the reference. Missing fields or options may be added with a `schema` + `overwrite: true` that keeps every existing field. Never remove, rename, or change the type of an existing field or option, never pass `confirmDestructive` on your own, and never overwrite a kind that differs in an incompatible way. Report each conflict to the user with the field names and stop for that kind.
<!-- desktop-only -->
5. Switching an existing personal kind to team needs `promoteExistingItems: true`; ask the user first.
<!-- /desktop-only -->

## 2. Predicate registry

<!-- desktop-only -->
Read the project's current registry from `.nimbalyst/predicates.yaml` at the workspace root (for a team project this is the local copy of the team's registry; a missing file means an empty registry).
<!-- /desktop-only -->
<!-- remote-only
Read the project's current registry from the `predicates` array in the `tracker_list_types` result (a missing array means an empty registry). Ignore any `.nimbalyst/predicates.yaml`: it is not the server's copy.
-->
Merge in every predicate from `../knowledge-graph/references/predicates.yaml` whose `id` is not already there, keep all existing ones unchanged, and call `tracker_define_type` with `predicates` set to the merged array. The call replaces the whole registry, so never send only the reference list. An existing predicate with the same `id` but a different definition is a conflict: keep the existing one and report it. If nothing is missing, make no call.

<!-- desktop-only -->
In a team project the registry becomes visible to teammates and the web console once team publishing of the registry ships; until then it is written to this workspace only.
<!-- /desktop-only -->

## 3. Wiki home page

Look for an `entity` with `kind: home` (`tracker_list` with `type: entity` and `where` on `kind`). If one exists, use it and report it. Otherwise create one: `kind: home`, no `parent`, a title such as "<Project> wiki", and a short body saying what the wiki covers. There is one home page per project; if you find several, report them and use none until the user picks.

## 4. Guide page

The guide tells people and agents what belongs in the wiki. It is a wiki page, so it syncs to the team and the web console like any other page, and a team may rewrite it completely.

- **Base version:** `1`. Bump it whenever `references/wiki-guide.md` changes.
- **Find it:** an `entity` whose `aliases` contain `wiki-guide` (include archived items; an archived guide means the team retired it, so report that and do not recreate it).

If there is no guide page, create it:

- `type: entity`, `title: How we write this wiki`, `kind: topic`, `parent` set to the home page, `aliases: [wiki-guide]`.
- `tags: [wiki-guide-base:1]` (the base version it was installed from).
- `description`: the full text of `references/wiki-guide.md`, unchanged.
<!-- desktop-only -->
- In a team project, publish it if the tracker leaves it as a draft, then read it back with `tracker_get` and confirm it has an issue key and the body.
<!-- /desktop-only -->
<!-- remote-only
- Read it back with `tracker_get` and confirm it has an issue key and the body.
-->

If a guide page already exists, **never overwrite it**. Compare its body with `references/wiki-guide.md`, ignoring whitespace-only differences, and read its `wiki-guide-base:<n>` tag:

- Same text: report "already present, matches base version <n>".
- Different text, tag equals the current base version: the team has edited it. Report "already present, edited by the team".
- Different text, older or missing tag: the base guide has changed since it was installed, and the team may also have edited it. Report both facts.

In the two "different" cases, offer the user a diff between their page and the current base, and offer a merge: keep every team edit, and propose only the base changes that do not conflict with them. Write the merged body with `tracker_update` (`description`, plus the tag set to the current base version, keeping other tags) only after the user approves the merged text. A team that has replaced the guide on purpose may decline; that is final until they ask again.

## Report

End with one line per step: kinds (each kind: created / already present / fields added / conflict), registry (predicates added or none), home page (key), guide page (key and status from step 4).
