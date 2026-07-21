import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import { buildClaudeCodeSystemPrompt } from "../../../packages/runtime/src/ai/prompt";

type Mode = "raw" | "nimbalyst";

interface EndpointDescriptor {
  port: number;
  token: string;
}

interface McpServerConfig {
  type: "sse";
  url: string;
  headers: { Authorization: string };
}

const mode = process.argv[2] as Mode | undefined;
const dryRun = process.argv.includes("--dry-run");

if (mode !== "raw" && mode !== "nimbalyst") {
  console.error(
    "Usage: npx tsx scripts/manual-tests/claude-context-overhead/run.ts <raw|nimbalyst> [--dry-run]"
  );
  process.exit(2);
}

const workspacePath = process.cwd();
const homePath = homedir();
const userDataPath =
  process.env.NIMBALYST_USER_DATA_DIR ??
  (process.platform === "darwin"
    ? join(homePath, "Library/Application Support/@nimbalyst/electron")
    : process.platform === "win32"
    ? join(process.env.APPDATA ?? homePath, "@nimbalyst/electron")
    : join(homePath, ".config/@nimbalyst/electron"));
const descriptorPath =
  process.env.NIMBALYST_MCP_DESCRIPTOR ??
  join(userDataPath, "mcp-endpoint.json");
const cliPath =
  process.env.CLAUDE_BIN ?? join(homePath, ".claude/local/claude");
const proxyUrl =
  process.env.CLAUDE_CONTEXT_PROXY_URL ?? "http://127.0.0.1:8377";
const model = process.env.CLAUDE_CONTEXT_MODEL ?? "fable";
const maxBudgetUsd = process.env.CLAUDE_CONTEXT_MAX_BUDGET_USD ?? "2";

if (!existsSync(cliPath)) {
  throw new Error(
    `Claude CLI not found at ${cliPath}. Set CLAUDE_BIN to the current binary.`
  );
}

const defaultExtensionMcpNames = [
  "developer",
  "ios-dev",
  "sqlite-browser",
  "memory",
  "browser",
  "homekit-mcp",
  "namenym",
  "image-generation",
  "jupyter",
  "slides",
  "replicad",
  "mindmap",
  "excalidraw",
  "datamodellm",
  "electronics",
  "automations",
];

const extensionMcpNames = process.env.NIMBALYST_EXTENSION_MCP_NAMES
  ? process.env.NIMBALYST_EXTENSION_MCP_NAMES.split(",")
      .map((name) => name.trim())
      .filter(Boolean)
  : defaultExtensionMcpNames;

const defaultPluginDirs = [
  "automations",
  "datamodellm",
  "developer",
  "excalidraw",
  "ios-dev",
  "mockuplm",
  "nimbalyst-mindmap",
  "nimbalyst-slides",
]
  .map((name) => join(userDataPath, "extensions", name, "claude-plugin"))
  .concat([
    join(workspacePath, "packages/extensions/extension-dev-kit/claude-plugin"),
    join(workspacePath, "packages/extensions/feedback/claude-plugin"),
    join(workspacePath, "packages/extensions/planning/claude-plugin"),
    join(workspacePath, ".claude/plugins/.nimbalyst-generated/electronics"),
  ]);

const pluginDirs = (
  process.env.NIMBALYST_PLUGIN_DIRS
    ? process.env.NIMBALYST_PLUGIN_DIRS.split(delimiter)
    : defaultPluginDirs
).filter((pluginDir) => pluginDir && existsSync(pluginDir));

function resolveExtensionDevPort(): number | undefined {
  const explicitPort = Number(process.env.NIMBALYST_EXTENSION_DEV_PORT);
  if (Number.isInteger(explicitPort) && explicitPort > 0) {
    return explicitPort;
  }

  const mainLogPath = join(userDataPath, "logs/main.log");
  if (!existsSync(mainLogPath)) {
    return undefined;
  }

  const matches = [
    ...readFileSync(mainLogPath, "utf8").matchAll(
      /\[Extension Dev MCP\] Successfully started on port (\d+)/g
    ),
  ];
  const latestPort = Number(matches.at(-1)?.[1]);
  return Number.isInteger(latestPort) && latestPort > 0
    ? latestPort
    : undefined;
}

const addendum =
  mode === "nimbalyst"
    ? buildClaudeCodeSystemPrompt({
        hasSessionNaming: true,
        hasOutOfBandNaming: true,
        trackersEnabled: true,
        toolReferenceStyle: "claude",
      })
    : "";

let mcpServers: Record<string, McpServerConfig> = {};
let extensionDevPort: number | undefined;

if (mode === "nimbalyst") {
  if (!existsSync(descriptorPath)) {
    throw new Error(
      `Nimbalyst MCP descriptor not found at ${descriptorPath}. Start Nimbalyst first.`
    );
  }

  const descriptor = JSON.parse(
    readFileSync(descriptorPath, "utf8")
  ) as EndpointDescriptor;
  const sessionId = crypto.randomUUID();
  const query = `workspacePath=${encodeURIComponent(
    workspacePath
  )}&sessionId=${encodeURIComponent(sessionId)}`;
  const headers = { Authorization: `Bearer ${descriptor.token}` };
  const makeConfig = (port: number, endpoint: string): McpServerConfig => ({
    type: "sse",
    url: `http://127.0.0.1:${port}${endpoint}?${query}`,
    headers,
  });

  mcpServers = {
    nimbalyst: makeConfig(descriptor.port, "/mcp/core"),
    "nimbalyst-host": makeConfig(descriptor.port, "/mcp/host"),
    "nimbalyst-trackers": makeConfig(descriptor.port, "/mcp/trackers"),
    "nimbalyst-situational": makeConfig(descriptor.port, "/mcp/situational"),
    ...Object.fromEntries(
      extensionMcpNames.map((shortName) => [
        `nimbalyst-${shortName}`,
        makeConfig(descriptor.port, `/mcp/ext/${shortName}`),
      ])
    ),
  };

  extensionDevPort = resolveExtensionDevPort();
  if (extensionDevPort) {
    mcpServers["nimbalyst-extension-dev"] = makeConfig(
      extensionDevPort,
      "/mcp"
    );
  }
}

const runSummary = {
  mode,
  dryRun,
  workspacePath,
  cliPath,
  model,
  proxyUrl,
  maxBudgetUsd,
  mcpServerNames: Object.keys(mcpServers),
  extensionDevPort,
  pluginDirs: mode === "nimbalyst" ? pluginDirs : [],
  addendumChars: addendum.length,
};

if (dryRun) {
  console.log(JSON.stringify(runSummary, null, 2));
  process.exit(0);
}

const args = [
  "-p",
  "Reply with only OK.",
  "--model",
  model,
  "--output-format",
  "stream-json",
  "--verbose",
  "--no-session-persistence",
  "--strict-mcp-config",
  "--mcp-config",
  JSON.stringify({ mcpServers }),
  "--permission-mode",
  "dontAsk",
  ...(mode === "nimbalyst" ? ["--append-system-prompt", addendum] : []),
  ...(mode === "nimbalyst"
    ? pluginDirs.flatMap((pluginDir) => ["--plugin-dir", pluginDir])
    : []),
  "--max-budget-usd",
  maxBudgetUsd,
];

const child = spawn(cliPath, args, {
  cwd: workspacePath,
  env: {
    ...process.env,
    ANTHROPIC_BASE_URL: proxyUrl,
    ENABLE_TOOL_SEARCH: "true",
    CLAUDE_CODE_ENTRYPOINT: "cli",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const exitCode = await new Promise<number | null>((resolve) =>
  child.on("close", resolve)
);
const outputPath = `/tmp/claude-context-overhead-${mode}.jsonl`;
writeFileSync(outputPath, stdout);

const events = stdout
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const assistant = events.find(
  (event) => event.type === "assistant" && !event.parent_tool_use_id
);
const usage = assistant?.message?.usage;
const init = events.find(
  (event) => event.type === "system" && event.subtype === "init"
);

console.log(
  JSON.stringify(
    {
      ...runSummary,
      outputPath,
      exitCode,
      stderr: stderr.trim() || undefined,
      claudeCodeVersion: init?.claude_code_version,
      connectedMcpServers: init?.mcp_servers,
      toolCount: init?.tools?.length,
      slashCommandCount: init?.slash_commands?.length,
      skillCount: init?.skills?.length,
      usage,
      contextTokens: usage
        ? usage.input_tokens +
          usage.cache_creation_input_tokens +
          usage.cache_read_input_tokens
        : undefined,
    },
    null,
    2
  )
);

process.exitCode = exitCode ?? 1;
