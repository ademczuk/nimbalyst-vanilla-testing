/**
 * Writes Nimbalyst's enabled MCP servers into the config files Grok Build and
 * Cursor Agent read.
 *
 * Neither CLI accepts an inline server list. Cursor reads `.cursor/mcp.json`
 * (workspace) or `~/.cursor/mcp.json`; Grok reads `~/.grok/config.toml` via
 * `grok mcp add`, but also accepts a plain `mcp.json` alongside it. So unlike
 * the ACP providers — which hand `mcpServers` to `session/new` and leave no
 * trace on disk — these providers must edit files the user also owns.
 *
 * That ownership is the whole design constraint here:
 *
 * - Only the `nimbalyst:`-prefixed keys are ever written or removed. A server
 *   the user added by hand, or that another tool added, is left exactly as it
 *   was — including on a full sync that removes stale Nimbalyst entries.
 * - The file is only rewritten when the resulting content differs, so enabling
 *   a session does not churn a file the user may have open.
 * - A malformed existing file is left alone rather than replaced. Overwriting
 *   it would destroy configuration we cannot read but the user can.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

/** Prefix that marks a server entry as Nimbalyst's to manage. */
export const NIMBALYST_MCP_KEY_PREFIX = 'nimbalyst:';

export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  [key: string]: unknown;
}

interface McpConfigFile {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

/**
 * Merge Nimbalyst's servers into an existing config object.
 *
 * Pure so the merge rules are testable without touching a real config file --
 * this is the function that must never drop a user's own entry.
 */
export function mergeNimbalystMcpServers(
  existing: McpConfigFile | null,
  servers: Record<string, McpServerEntry>,
): McpConfigFile {
  const base: McpConfigFile = existing ? { ...existing } : {};
  const previous = base.mcpServers ?? {};

  const next: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(previous)) {
    // Drop only our own stale entries; everything else survives untouched.
    if (!name.startsWith(NIMBALYST_MCP_KEY_PREFIX)) {
      next[name] = entry;
    }
  }
  for (const [name, entry] of Object.entries(servers)) {
    next[`${NIMBALYST_MCP_KEY_PREFIX}${name}`] = entry;
  }

  base.mcpServers = next;
  return base;
}

export type HeadlessAgentMcpTarget = 'cursor-agent' | 'grok-build';

/**
 * Resolve the config file to write for a target.
 *
 * Cursor is workspace-scoped when a workspace is known — that keeps a project's
 * servers out of the user's other projects. Grok's MCP configuration is
 * user-scoped only.
 */
export function resolveHeadlessAgentMcpConfigPath(
  target: HeadlessAgentMcpTarget,
  workspacePath: string | undefined,
  homedir = os.homedir(),
): string {
  if (target === 'cursor-agent') {
    return workspacePath
      ? path.join(workspacePath, '.cursor', 'mcp.json')
      : path.join(homedir, '.cursor', 'mcp.json');
  }
  return path.join(homedir, '.grok', 'mcp.json');
}

export class HeadlessAgentMcpConfigService {
  /**
   * Write the enabled servers for `target`, preserving everything the user
   * put there.
   *
   * Returns the path written, or `null` when nothing needed to change or the
   * existing file could not be parsed.
   */
  async sync(
    target: HeadlessAgentMcpTarget,
    servers: Record<string, McpServerEntry>,
    workspacePath?: string,
  ): Promise<string | null> {
    const configPath = resolveHeadlessAgentMcpConfigPath(target, workspacePath);

    let existing: McpConfigFile | null = null;
    let existingRaw: string | null = null;
    try {
      existingRaw = await fs.readFile(configPath, 'utf8');
      existing = JSON.parse(existingRaw) as McpConfigFile;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        // A file we cannot parse is a file we must not overwrite: it is the
        // user's configuration, and replacing it would destroy settings we
        // simply failed to read.
        return null;
      }
    }

    const merged = mergeNimbalystMcpServers(existing, servers);
    const nextRaw = `${JSON.stringify(merged, null, 2)}\n`;
    if (existingRaw !== null && existingRaw === nextRaw) {
      return null;
    }

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, nextRaw, 'utf8');
    return configPath;
  }
}

export const headlessAgentMcpConfigService = new HeadlessAgentMcpConfigService();
