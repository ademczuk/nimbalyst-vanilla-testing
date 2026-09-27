---
description: Record what this session established (decisions, answered questions, system facts) in the team wiki
argument-hint: "[optional focus]"
---

Review this session and record what it established in the team wiki, following the `wiki-keeper` skill for when and where to write and the `knowledge-graph` skill for how.

Focus, if given: $ARGUMENTS

1. If `mcp__nimbalyst-trackers__*` tools are available, use them and the desktop knowledge skills instead of the `wiki_*` tools.
2. Resolve `repo` and `project` and call `wiki_status` as the `wiki-keeper` skill describes. If the state is `ambiguous`, ask which project and pin it. If it is `unbound`, follow the skill's connecting steps; if the repository stays unconnected, say so and stop.
3. List the candidates from this session: decisions made (with the reason), questions answered, and facts about the system that were established. Drop routine progress and anything the code or `git log` already says.
4. If nothing is left, reply "nothing to record" and stop.
5. Otherwise, check the wiki for existing pages and claims on each candidate, then write inside one changeset (it is the session's activity log): update or supersede what exists, create only what is missing. When the project came from a pin or the user is in several teams, first say which project the writes go to.
6. Reply with a short list of what you recorded, then the changeset URL as the last line.
