# Claude context-overhead manual test

This harness measures the first-turn context cost of Nimbalyst's Claude Code addendum, MCP servers, and extension plugins against a matched raw Claude Code control. It uses the real Claude CLI and Anthropic API; each non-dry run consumes real account quota and may incur cost.

The two modes deliberately share the same prompt, model, working directory, ToolSearch setting, permission mode, and empty user MCP configuration:

- `raw` loads no Nimbalyst MCP servers, addendum, or extension plugins.
- `nimbalyst` loads the running app's authenticated MCP endpoints, the current `buildClaudeCodeSystemPrompt()` output, and the configured extension plugins.

## Prerequisites

- Run commands from the repository root.
- Be signed in with the current Claude Code CLI. The default binary is `~/.claude/local/claude`; set `CLAUDE_BIN` to override it.
- Start Nimbalyst before using `nimbalyst` mode. The runner reads the live, user-only `mcp-endpoint.json` descriptor and does not modify Claude settings.
- Install repository dependencies so `npx tsx` can import the runtime prompt.

## Validate configuration without an API call

```bash
npx tsx scripts/manual-tests/claude-context-overhead/run.ts raw --dry-run
npx tsx scripts/manual-tests/claude-context-overhead/run.ts nimbalyst --dry-run
```

Dry-run output contains no MCP bearer token. Check the Claude binary, model, MCP server names, extension-dev port, plugin directories, and addendum size.

## Run the A/B measurement

Start the structural proxy in one terminal:

```bash
node scripts/manual-tests/claude-context-overhead/proxy.mjs
```

In another terminal, run the matched control followed by Nimbalyst:

```bash
npx tsx scripts/manual-tests/claude-context-overhead/run.ts raw
npx tsx scripts/manual-tests/claude-context-overhead/run.ts nimbalyst
```

Compare `contextTokens` in the two summaries. The Nimbalyst-only overhead is:

```text
nimbalyst contextTokens - raw contextTokens
```

The runner writes full Claude stream output to:

- `/tmp/claude-context-overhead-raw.jsonl`
- `/tmp/claude-context-overhead-nimbalyst.jsonl`

The proxy appends structural request summaries to `/tmp/nimbalyst-claude-context-proxy.jsonl`. It records schema sizes and short text previews, not full request content. Stop it with Ctrl-C after both runs.

## Overrides

- `CLAUDE_BIN`: Claude executable path.
- `CLAUDE_CONTEXT_MODEL`: model alias; defaults to `fable`.
- `CLAUDE_CONTEXT_MAX_BUDGET_USD`: CLI safety cap; defaults to `2`.
- `CLAUDE_CONTEXT_PROXY_URL`: proxy URL; defaults to `http://127.0.0.1:8377`.
- `CLAUDE_CONTEXT_PROXY_LOG`: proxy summary path.
- `NIMBALYST_MCP_DESCRIPTOR`: live MCP descriptor path.
- `NIMBALYST_EXTENSION_DEV_PORT`: override extension-dev MCP port detection.
- `NIMBALYST_EXTENSION_MCP_NAMES`: comma-separated extension MCP short names.
- `NIMBALYST_PLUGIN_DIRS`: platform-delimited plugin-directory override.

The built-in extension-name list is a snapshot of the normal development profile. If extensions are added or disabled, use the two override variables so the manual run matches the target session's connected MCP/plugin set.

## Reference result

On 2026-07-21, Claude Code 2.1.210 with `fable` measured:

- Matched raw control: 43,178 context tokens.
- Nimbalyst with 21 connected MCP servers, 303 tools, and extension plugins: 56,250 context tokens.
- Nimbalyst-only delta: 13,072 tokens (30.3%).

Treat these as a historical NIM-1988 checkpoint, not a fixed budget. CLI, prompt, MCP, extension, and repository-context changes can all move the result.
