---
description: Build, refine, and publish cumulative public release notes, then promote the current alpha prerelease to stable
---
Promote the current GitHub alpha prerelease to the public stable release.

This command's main job is to build the **proper cumulative public release notes** covering everything since the last stable public release, let the user edit them, then use the final text to update the existing GitHub release before making it public.

## Contract: `PUBLIC_RELEASE_NOTES.md` is regenerated every run

Every invocation of `/promote-public-release` overwrites `PUBLIC_RELEASE_NOTES.md` from scratch.

The expected workflow is:
1. Generate a fresh cumulative draft from `CHANGELOG.md`, crediting every outside contributor inline.
2. Let the user edit that file directly.
3. Re-read exactly what is on disk.
4. Commit the file for repository history.
5. Update the existing GitHub release notes from that file.
6. Clear the prerelease flag on the existing release and mark it latest.

Do **not** merge with old `PUBLIC_RELEASE_NOTES.md` content. Always rebuild it from scratch.

## PHASE 1: COLLECT RELEASE CONTEXT

1. **Get the version being promoted**:
   ```bash
   git describe --tags --abbrev=0
   ```
   This should be the current `v*` tag to promote.

2. **Inspect the existing GitHub release for that tag**:
   ```bash
   gh release view [VERSION] --json name,url,isPrerelease,isDraft
   ```
   Expectations:
   - the release already exists
   - `isPrerelease` should be `true`
   - `isDraft` should be `false`

   If the release does not exist, stop and tell the user the alpha prerelease has not been published yet.

3. **Find the last stable public release before the current tag**:
   ```bash
   gh release list --limit 50 --json tagName,isPrerelease,isDraft,publishedAt \
     | jq '[.[] | select(.isDraft == false and .isPrerelease == false and .tagName != "[VERSION]")] | sort_by(.publishedAt) | reverse | .[0]'
   ```
   Extract that `tagName`. This is the lower bound for cumulative notes.

   If there is no prior stable release, tell the user this is the first public stable release and use all release sections up to `[VERSION]`.

4. **Build the contributor map for the range** — do this BEFORE drafting, so credit is written into the bullets rather than bolted on afterwards:
   ```bash
   git log [LAST_PUBLIC_VERSION]..[VERSION] --format='%h|%an|%s' --perl-regexp --author='^(?!Greg Hinkle)'
   ```
   For each SHA, resolve the GitHub handle from the commit itself, not from the PR list:
   ```bash
   gh api repos/nimbalyst/nimbalyst/commits/<sha> --jq '.author.login'
   ```
   This is authoritative. Do **not** derive the contributor list from `gh pr list` filtered by merge date — a contribution that landed by cherry-pick shows its PR as `CLOSED`, never `MERGED`, and is invisible to that query. In the v0.75.5 -> v0.76.2 range, PR #955 (@Yogitmeister) was exactly that case, and a merge-date query would have dropped them.

   Record, per contributor commit: the handle, and the **GitHub issue** it fixes (from the commit body's `Fixes #N`, or the PR number if there is no issue). Never cite a `NIM-###` key in public notes — those are tracker-scoped and resolve to an unrelated item for any reader.

5. **Display the promotion summary and overwrite warning**:
   Show the user:
   - `Version to promote: [VERSION]`
   - `Current GitHub release: prerelease`
   - `Last stable public release: [LAST_PUBLIC_VERSION]` or `none`
   - `Contributors in range: @handle (#N), ...` or `none`
   - A warning that `PUBLIC_RELEASE_NOTES.md` will be overwritten with a fresh cumulative draft

## PHASE 2: BUILD CUMULATIVE PUBLIC RELEASE NOTES

1. **Read `CHANGELOG.md` and extract cumulative notes**:
   - Include every release section after `[LAST_PUBLIC_VERSION]` through `[VERSION]`, inclusive.
   - Pull from `Added`, `Changed`, and `Fixed`.
   - Skip `Removed` unless it reflects a user-visible change that belongs in public notes.

2. **Reconcile the sections against the actual commit range.** Section boundaries and tag boundaries do not always agree: a commit that lands after a tag is cut often gets filed under the section that was just published, so its bullet belongs to this range even though its heading does not. Such a bullet is announced in **no** release unless you catch it here.

   Diff the two views: every commit in `git log [LAST_PUBLIC_VERSION]..[VERSION]` should have a home in the notes. For any user-visible commit whose changelog bullet sits in an *already-published* section, check whether that bullet actually shipped:
   ```bash
   gh release view [LAST_PUBLIC_VERSION] --json body --jq '.body' | grep -i "<distinctive phrase>"
   ```
   If it is not in the published body, pull the bullet forward into this release's notes and tell the user you did.

   This happened to #1375 (@timscott-frogslayer, macOS accessibility) during the v0.76.2 promotion: committed after the v0.75.5 tag, filed under the `[0.75.5]` heading, absent from the published v0.75.5 notes, and only caught on a second pass.

3. **Transform into public-facing notes**:
   - Rewrite into concise user-facing language.
   - Group into:
     - `### New Features`
     - `### Improvements`
     - `### Fixed`
   - Remove internal-only items:
     - type fixes
     - refactors
     - tooling/CI
     - developer-only maintenance
   - Keep the notes cumulative across releases since the last stable public release.

4. **Credit every outside contributor, inline, in the bullet describing their work.** This is not optional and it is not a nice-to-have — an outside contributor's only public reward for the work is their name on the release. Getting it wrong is the one release mistake that costs us a contributor rather than a few minutes.

   The format, matching v0.74.3:
   ```text
   - A tool permission request that timed out or was dropped now says nobody answered it,
     instead of reporting a cancellation you never made (#1348, contributed by @forcewalkerneo).
   ```
   - Cite the **GitHub issue** number when there is one, the PR number when there is not.
   - `@handle` is the login resolved in Phase 1, verbatim, including its capitalization.
   - When one bullet merges two contributors' fixes, name both: `(#1217, #1144, contributed by @forcewalkerneo and @Yogitmeister)`.
   - Credit goes inline only. Do not add a separate "Contributors" or "Thanks" section.
   - Do not credit Greg's own commits.

   Before moving on, check the map from Phase 1 against the draft: every handle in it must appear at least once in the notes. A contributor commit whose fix you dropped as internal-only is fine; a contributor commit whose fix you kept but whose credit you dropped is not.

   Credit only survives if the commit's authorship does, so this depends on PRs being merged `--no-ff` with the contributor as author. If `gh api .../commits/<sha> --jq .author.login` returns `null` for a contribution, the authorship was lost in the merge — say so rather than guessing a handle.

5. **Overwrite `PUBLIC_RELEASE_NOTES.md`**:
   - Replace the file contents entirely with the new draft.
   - The file should be a clean public release-notes draft, not a changelog dump.

6. **Stop for user edits**:
   Tell the user:
   > I rebuilt `PUBLIC_RELEASE_NOTES.md` from `CHANGELOG.md` covering `[LAST_PUBLIC_VERSION] -> [VERSION]`. Please edit it directly. Tighten language, remove anything you don't want public, and adjust the framing. Tell me when you're ready and I'll publish exactly what is on disk.

   Do **not** proceed until the user confirms readiness.

## PHASE 3: COMMIT THE FINAL NOTES

1. **Re-read `PUBLIC_RELEASE_NOTES.md`** so you publish exactly what is on disk after the user's edits.

2. **Commit the file**:
   ```bash
   git add PUBLIC_RELEASE_NOTES.md
   git commit -m "docs: public release notes for [VERSION]"
   git push origin main
   ```

   If the user prefers not to commit yet, ask before skipping this step. The default is to commit it.

## PHASE 4: UPDATE THE EXISTING GITHUB RELEASE AND PROMOTE IT

1. **Update the GitHub release notes from the edited file**:
   ```bash
   gh release edit [VERSION] --notes-file PUBLIC_RELEASE_NOTES.md
   ```

2. **Promote the existing prerelease to stable AND mark it latest — both flags, one call**:
   ```bash
   gh release edit [VERSION] --prerelease=false --latest
   ```
   `--latest` is REQUIRED and is the step that keeps getting skipped (v0.74.3 on 2026-08-21, v0.75.5 on 2026-08-28). Clearing the prerelease flag does **not** make a release "latest". The stable update channel resolves `/releases/latest`, so a release that is public but not latest is invisible to every user on stable — it looks published on the releases page while nobody is being offered it.

   Pass both in the same call: a release cannot be marked Latest while it is still a prerelease. The command is idempotent, so it is safe to re-run to fix after the fact.

3. **Verify the result**:
   ```bash
   gh release view [VERSION] --json url,isPrerelease,isDraft
   gh api repos/nimbalyst/nimbalyst/releases/latest --jq '{tag: .tag_name, prerelease: .prerelease, draft: .draft}'
   ```
   Confirm:
   - `isPrerelease` is now `false`
   - `isDraft` is `false`
   - the `/releases/latest` API call returns `[VERSION]` — this is the check that matters; `gh release view` has no `isLatest` field, so it cannot tell you this

4. **Confirm to the user**:
   - Show the release URL
   - State that the alpha prerelease is now the public stable release

## PHASE 5: ANNOTATE POSTHOG

Only public stable releases get an annotation. Interim alpha prereleases never do, so this phase belongs here and nowhere else — do not add it to `/release-alpha`.

1. **Get the release timestamp**:
   ```bash
   gh release view [VERSION] --json publishedAt
   ```

2. **Create the annotation** via the PostHog MCP `exec` tool, matching the existing convention exactly — content is `v[X.Y.Z] released`, nothing more, and no emoji:
   ```text
   call annotation-create {"content": "[VERSION] released", "date_marker": "[PUBLISHED_AT]", "scope": "project"}
   ```
   Keep the tag's leading `v` — the annotation text reads `v0.75.5 released`.

3. **Confirm to the user** that the release marker is on the charts, with the annotation id.

## Example Usage

```text
User: /promote-public-release
Assistant:
- Finds current tag
- Finds the previous stable public release
- Rebuilds PUBLIC_RELEASE_NOTES.md cumulatively across those releases
- Waits for edits
- Commits the final file
- Updates the GitHub release notes
- Clears the prerelease flag
- Adds the "vX.Y.Z released" PostHog annotation
```
