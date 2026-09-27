# How we write this wiki

This wiki holds what a capable agent would need to rebuild this project from scratch, and nothing more. The code says how the project works. The wiki says what the team wants it to be, why, and what the team knew when it decided. Agents and people read this page before adding to the wiki.

Edit this page to fit your team. It overrides the base guide Nimbalyst ships.

## The test for every page and statement

Write something down only if all three are true:

1. **A strong model would get it wrong without the note.** It could not infer it from the code, the repository history, or general knowledge. It is not a best practice, a library's documentation, or anything a modern model already does well.
2. **A person chose it, or a person needed it to choose.** It records a decision, a preference, a constraint, or a judgment of quality, or the context the team weighed when making one. You don't need to know the competitors to build to the spec, but the team needed to know them to decide what the product does, and the next decision will need them too. What the code merely implies doesn't count.
3. **It will still matter when the code has changed.** Implementation details, file layouts, and step-by-step plans expire. Intent, constraints, and reasons last.

If a statement fails any test, leave it out. If an existing page fails, supersede or archive it. Deleting stale content is part of maintaining the wiki.

## What belongs here

- **What the project is and who it is for.** The problem, the users, and what the project deliberately is not.
- **Decisions and their reasons.** Especially the non-obvious ones, the rejected alternatives, and the reversals. Write the reason in a sentence; the reason is what stops a later agent from undoing the decision.
- **Taste and quality bar.** What "good" means here, where the team departs from convention, and which trade-offs the team makes on purpose (for example, "local-first before team features" or "no curated default model list").
- **Constraints that are not visible in the code.** Legal, security, privacy, cost, platform, and partner commitments.
- **Hard-won lessons.** Incidents and failures a model would repeat, with the one rule each one taught. Skip the incident narrative.
- **Decision context.** What the team weighs when it decides: customers and what they asked for, competitors and where they overlap, markets, technologies, and partners, with the facts about them the team relies on, each dated and sourced. Link decisions to the context they rested on, so a later reader can tell when a changed fact reopens a decision.
- **Open questions.** What the team has not decided, who owns each question, and the current position.

## What does not belong here

- Anything a model already knows: language features, framework usage, standard patterns, general engineering practice.
- Anything the code already states: APIs, schemas, file structure, configuration values. Link to the code if a pointer helps.
- Plans for individual features, task lists, status updates, and meeting notes. Those belong in trackers and expire when the work ships.
- Changelogs and release notes.
- Restatements. If a fact is on one page, link to it; do not copy it.

## How to write

- Short. A page is usually a few paragraphs. A decision is usually one sentence of choice and one of reason.
- Specific. Name the thing, the date, and the person or team who decided. "We chose X over Y because Z (decided by the platform team, 2026-03)" beats "X is preferred."
- One idea per statement. Facts about the domain go in as statements with a subject, a relationship, and a value, each with a date and a source, not buried in prose.
- State certainty. Mark what is decided, what is observed, and what is inferred. Do not present an inference as a decision.
- Prefer updating to appending. When something changes, supersede the old statement so its history stays visible.

## For agents

- Read this page and the wiki home before writing.
- Before adding a page, search for an existing one. Extend it or link to it.
- Record a decision when a person makes it, in their words, attributed to them. Do not invent decisions or reasons.
- When the wiki's structure does not fit what you need to record (a missing category or relationship), propose a change instead of forcing the content into the wrong place.
- When you are unsure whether something passes the test, leave it out and ask.
