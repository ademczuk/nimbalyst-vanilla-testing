# Testing pipeline

This repo is an auto-synced public mirror of `nimbalyst/nimbalyst` (see `.github/workflows/upstream-sync.yml`). On top of the mirror it runs a tiered test pipeline so upstream code gets checked here, both on `main` after each sync and on open PRs before they merge. Results are shareable with the nimbalyst dev team and can later be proposed back upstream.

## How a sync triggers the tests

`upstream-sync` pushes merged upstream commits to `main` using a Personal Access Token. A PAT push (unlike the default `GITHUB_TOKEN`) triggers downstream workflows, so the `main`-tier tests fire automatically after each hourly sync.

## Tier 1: health checks on main (no secrets, free)

`ci.yml` is upstream's own workflow, re-enabled here. On ubuntu it runs unit tests (vitest), the TypeScript typecheck across electron / runtime / extension-sdk and four extensions, and the iOS transcript-bundle build smoke. No secrets, free on public repos. Fast red/green on every sync.

## Tier 1b: health checks on open PRs (no secrets)

`pr-test.yml` tests open pull requests on upstream BEFORE they merge. It lists open PRs, fetches each PR head (`refs/pull/N/head`), and runs the same unit tests + typecheck per PR, producing a per-PR red/green. This is most useful for fork PRs whose CI upstream has not approved or run yet (GitHub holds first-time-contributor fork workflows for maintainer approval).

Runs daily and on demand:

```
# test all open PRs (default limit 8)
gh workflow run pr-test.yml -R ademczuk/nimbalyst-vanilla-testing

# test a single PR
gh workflow run pr-test.yml -R ademczuk/nimbalyst-vanilla-testing -f pr=669
```

SECURITY: PR code comes from forks and is untrusted, and these steps execute it (npm ci scripts, vitest, tsc). The workflow carries NO secrets and a read-only token scoped to the fetch step only, so untrusted code can never read a key. It runs on schedule and manual dispatch only, never automatically when a PR opens.

## Tier 2: provider integration smoke on main (your API keys)

`provider-smoke.yml` drives nimbalyst's live provider classes through `ProviderFactory` against the real Claude and OpenAI APIs, proving each provider can complete a tool-using turn (the `applyDiff` edit flow). It reuses upstream's own gated integration tests, so it adds no test code.

A failing provider test is classified, not blindly failed:

- pass: the real provider call completed the tool flow.
- infra: the provider was unreachable (no credit, quota, rate limit, auth, or outage). Treated as NEUTRAL, the job stays green with a warning. A billing or outage problem never reads as a nimbalyst regression.
- regression: the provider misbehaved inside nimbalyst's code. The job goes RED.
- missing: a tracked upstream test was renamed or removed. The job goes RED so the smoke target gets fixed.

Safe by default: with no keys set, the job skips and stays green. Keys are scoped to only the two provider steps, never `npm ci` or the build. Real calls happen on AI-path syncs, nightly, and on manual dispatch.

### Enable it

```
gh secret set ANTHROPIC_API_KEY -R ademczuk/nimbalyst-vanilla-testing
gh secret set OPENAI_API_KEY    -R ademczuk/nimbalyst-vanilla-testing
gh workflow run provider-smoke.yml -R ademczuk/nimbalyst-vanilla-testing
```

### Use API keys, not your CLI subscription logins

Put provider API keys in GitHub Secrets. Do not reuse your Claude Code / Codex / Gemini OAuth subscription logins in CI:

- Anthropic restricts Pro/Max OAuth credentials to Claude Code and claude.ai. Using them in another tool, and a CI harness is another tool, breaks the Consumer Terms.
- Subscription OAuth tokens are built for interactive refresh. They expire and do not refresh cleanly in a headless runner.

Also note: a Claude Pro/Max subscription does not fund the developer API. API access needs separately purchased prepaid credit at console.anthropic.com under Plans & Billing. The smoke uses cheap models (`claude-sonnet-4-6`, `gpt-4o-mini`); runner minutes are free on public repos. This does not change the app rule that nimbalyst must never read API keys from environment variables; that rule is about the product runtime, and test code legitimately reads keys from the CI env and passes them in explicitly.

### Gemini, Codex, and Copilot

These three are not API-key providers, so they cannot ride the Tier 2 smoke:

- Gemini: no first-class provider; reachable only through the OpenCode CLI or the gemini-antigravity extension (your local `~/.gemini` OAuth and a spawned language server).
- Codex (`openai-codex`): Codex CLI login.
- Copilot (`copilot-cli`): GitHub Copilot CLI login (`copilot --acp --stdio`), tied to your Copilot subscription, no API key.

Covering them means the Tier 3 E2E path: install and authenticate each CLI inside the runner and drive the real Electron app (like upstream's `RUN_REAL_CODEX` spec).

## Roadmap: Tier 3, end-to-end (Playwright + Electron)

Upstream ships Playwright E2E specs (including a real-Codex spec gated by `RUN_REAL_CODEX=1`) that launch the actual Electron app. Running these in CI needs `ubuntu-22.04` (the 24.04 default breaks Electron's sandbox), `xvfb` for a virtual display, a CI-only `--no-sandbox` launch flag in `packages/electron/e2e/helpers.ts`, the Vite dev server on port 5273 started in the background, and `workers: 1` (PGLite allows a single connection). This is the full "install and use the product" tier and the path that covers the CLI-subscription agents above. It needs a small code change to the launch args, so it is a follow-up.

## Proposing this upstream

When the pipeline is proven here, it can go to nimbalyst as a PR with no code coupling to this account:

- Reference secrets by name only, optionally via a GitHub Environment named `provider-tests` for required-reviewer gating. Upstream adds the same-named secrets and the YAML stays identical.
- The provider tier runs on push / dispatch / schedule only, never on a fork `pull_request` (forks get no secrets by design). Never use `pull_request_target` to hand secrets to fork code.
- Pin third-party actions to commit SHAs and keep `permissions: contents: read` for the security review.

## Workflow status on this mirror

- `upstream-sync` - enabled (hourly mirror)
- `ci.yml` - enabled (Tier 1, main health)
- `pr-test.yml` - enabled (Tier 1b, open-PR health)
- `provider-smoke.yml` - enabled (Tier 2, provider integration; skips until keys are set)
- `electron-build.yml`, `internal-build.yml`, `ios-transcript-tests.yml`, `publish-extension-sdk.yml` - disabled (need org signing/publish secrets, or burn macOS minutes)
