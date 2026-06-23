# Testing pipeline

This repo is an auto-synced public mirror of `nimbalyst/nimbalyst` (see `.github/workflows/upstream-sync.yml`). On top of the mirror it runs a tiered test pipeline, so every merged upstream PR gets checked here. Results are shareable with the nimbalyst dev team and can later be proposed back upstream.

## How a sync triggers the tests

`upstream-sync` pushes merged upstream commits to `main` using a Personal Access Token. A PAT push (unlike the default `GITHUB_TOKEN`) triggers downstream workflows, so the tiers below fire automatically after each hourly sync. No extra glue is needed.

## Tier 1: health checks (no secrets, free)

`ci.yml` is upstream's own workflow, re-enabled on this mirror. On ubuntu it runs:

- unit tests (vitest)
- TypeScript typecheck (`tsc --noEmit`) across electron, runtime, extension-sdk and four extensions
- the iOS transcript-bundle build smoke

No secrets, free on public repos. This is the fast red/green on every sync.

## Tier 2: provider integration smoke (your API keys)

`provider-smoke.yml` drives nimbalyst's live provider classes through `ProviderFactory` against the real Claude and OpenAI APIs, proving each provider can complete a tool-using turn (the `applyDiff` edit flow). It reuses upstream's own gated integration tests, so it adds no test code to the mirror.

Safe by default: with no keys set, the job skips and stays green. It only spends on real API calls when you add keys AND the synced change touched `packages/runtime` or `packages/electron` (or you run it nightly / manually).

### Enable it (the one thing you need to do)

Add API keys as repo secrets:

```
gh secret set ANTHROPIC_API_KEY -R ademczuk/nimbalyst-vanilla-testing
gh secret set OPENAI_API_KEY    -R ademczuk/nimbalyst-vanilla-testing
```

Then run it once to confirm:

```
gh workflow run provider-smoke.yml -R ademczuk/nimbalyst-vanilla-testing
```

### Use API keys, not your CLI subscription logins

Put provider API keys in GitHub Secrets. Do not try to reuse your Claude Code / Codex / Gemini OAuth subscription logins in CI:

- Anthropic restricts Pro/Max OAuth credentials to Claude Code and claude.ai. Using them in another tool, and a CI harness is another tool, breaks the Consumer Terms.
- Subscription OAuth tokens are built for interactive refresh. They expire and do not refresh cleanly in a headless runner, so the pipeline would flake on token death instead of on real regressions.

API keys cost a few cents per run, runner minutes are free on public repos, and the smoke uses cheap models (`claude-sonnet-4-6`, `gpt-4o-mini`).

This does not change the app rule that nimbalyst must never read API keys from environment variables. That rule is about the product runtime. Test code legitimately reads keys from the CI env and passes them into the provider explicitly.

### Gemini

There is no first-class Gemini provider in nimbalyst today. Gemini is reachable only through the OpenCode CLI, or the gemini-antigravity extension (which uses your local `~/.gemini` OAuth and a spawned language server). So Gemini cannot ride this simple API-key smoke. Covering it needs a heavier, host-provisioned test (see roadmap).

## Roadmap: Tier 3, end-to-end (Playwright + Electron)

Upstream ships Playwright E2E specs, including a real-Codex spec gated by `RUN_REAL_CODEX=1`, that launch the actual Electron app. Running these in CI needs:

- `ubuntu-22.04` (the 24.04 default breaks Electron's sandbox), `xvfb` for a virtual display, and a CI-only `--no-sandbox` launch flag in `packages/electron/e2e/helpers.ts`
- the Vite dev server on port 5273 started in the background
- `workers: 1` (PGLite allows a single connection)

This is the full "install and use the product" tier. It needs a small code change to the Electron launch args, so it is a follow-up rather than part of this first cut.

## Proposing this upstream

When the pipeline is proven here, it can go to nimbalyst as a PR with no code coupling to this account:

- Reference secrets by name only, optionally via a GitHub Environment named `provider-tests` for required-reviewer gating. Upstream adds the same-named secrets and the YAML stays identical.
- The provider tier runs on push / dispatch / schedule only, never on a fork `pull_request` (forks get no secrets by design). Never use `pull_request_target` to hand secrets to fork code.
- Pin third-party actions to commit SHAs and keep `permissions: contents: read` for the security review.

## Workflow status on this mirror

- `upstream-sync` - enabled (hourly mirror)
- `ci.yml` - enabled (Tier 1)
- `provider-smoke.yml` - enabled (Tier 2, skips until you add keys)
- `electron-build.yml`, `internal-build.yml`, `ios-transcript-tests.yml`, `publish-extension-sdk.yml` - disabled (need org signing/publish secrets, or burn macOS minutes)
