/**
 * Grok Build agent provider (xAI).
 *
 * Runs `grok -p <prompt> --output-format streaming-json` per turn. See
 * `GrokBuildProtocol` for why this transport was chosen over `grok agent
 * stdio` (ACP).
 *
 * File tracking is `'tool-args'`, not `'structured'`: Grok reports rich diff
 * blocks for edits but has no delete or move tool, so the filesystem watcher
 * stays on to catch removals. `providerFileTracking.ts` is the declaration.
 */

import { GrokBuildProtocol } from '../protocols/GrokBuildProtocol';
import { DEFAULT_MODELS } from '../../modelConstants';
import type { AIModel, AIProviderType } from '../types';
import type { MCPServerConfig } from '../../../types/MCPServerConfig';
import {
  HeadlessCliAgentProvider,
  type HeadlessCliAgentDescriptor,
  type HeadlessCliEnvironmentLoaders,
} from './HeadlessCliAgentProvider';

const DESCRIPTOR: HeadlessCliAgentDescriptor = {
  providerName: 'grok-build' as AIProviderType,
  displayName: 'Grok Build',
  description: 'xAI Grok Build CLI agent, driven headlessly over streaming JSON',
  executableName: 'grok',
  // The installer writes the real binary to `~/.grok/bin` and symlinks
  // `~/.local/bin`. It also symlinks `~/.local/bin/agent`, which the Cursor
  // installer claims too — never probe for that name.
  homeRelativeInstallPaths: ['.grok/bin/grok', '.local/bin/grok'],
  notInstalledMessage:
    'The Grok CLI is not installed. Install it with:\n\n'
    + '  curl -fsSL https://x.ai/cli/install.sh | bash\n\n'
    + 'Then run `grok login` to authenticate.',
  notLoggedInMessage:
    'Grok is not signed in. Run `grok login` in your terminal, then try again.',
  permissionModeMessage:
    'Grok Build requires "Allow Edits" permission mode. Its headless mode cannot '
    + 'pause a turn for a per-tool approval, so the whole turn is gated up front. '
    + 'Change the permission mode in workspace settings.',
};

export class GrokBuildProvider extends HeadlessCliAgentProvider {
  static readonly DEFAULT_MODEL = DEFAULT_MODELS['grok-build'];

  protected readonly descriptor = DESCRIPTOR;
  protected readonly protocol: GrokBuildProtocol;

  private static mcpConfigLoader: ((workspacePath?: string) => Promise<Record<string, MCPServerConfig>>) | null = null;
  private static shellEnvironmentLoader: (() => Record<string, string> | null) | null = null;
  private static enhancedPathLoader: (() => string) | null = null;
  private static grokPathLoader: (() => string | null) | null = null;

  constructor(deps?: { protocol?: GrokBuildProtocol }) {
    super(GrokBuildProvider.loaders());
    this.protocol = deps?.protocol ?? new GrokBuildProtocol();
  }

  private static loaders(): HeadlessCliEnvironmentLoaders {
    return {
      mcpConfigLoader: GrokBuildProvider.mcpConfigLoader,
      shellEnvironmentLoader: GrokBuildProvider.shellEnvironmentLoader,
      enhancedPathLoader: GrokBuildProvider.enhancedPathLoader,
      executablePathLoader: GrokBuildProvider.grokPathLoader,
    };
  }

  protected getLoaders(): HeadlessCliEnvironmentLoaders {
    return GrokBuildProvider.loaders();
  }

  protected configureProtocol(executablePath: string, env: Record<string, string> | null): void {
    this.protocol.setGrokPath(executablePath);
    this.protocol.setProcessEnv(env);
  }

  protected getDefaultModelId(): string {
    return GrokBuildProvider.DEFAULT_MODEL;
  }

  // --- Static injection setters (Electron main process, at startup) ---

  static setMCPConfigLoader(loader: ((workspacePath?: string) => Promise<Record<string, MCPServerConfig>>) | null): void {
    GrokBuildProvider.mcpConfigLoader = loader;
  }

  static setShellEnvironmentLoader(loader: (() => Record<string, string> | null) | null): void {
    GrokBuildProvider.shellEnvironmentLoader = loader;
  }

  static setEnhancedPathLoader(loader: (() => string) | null): void {
    GrokBuildProvider.enhancedPathLoader = loader;
  }

  static setGrokPathLoader(loader: (() => string | null) | null): void {
    GrokBuildProvider.grokPathLoader = loader;
  }

  /**
   * Grok exposes its catalog via `grok models`, which works without auth.
   *
   * The list is deliberately not hand-curated here: a static list is exactly
   * the drift that hid newly released models (NIM-1486). If the CLI cannot be
   * reached, return only the default so the picker is never empty.
   */
  static async getModels(): Promise<AIModel[]> {
    const ids = await GrokBuildProvider.listModelIds();
    return ids.map((id) => ({
      id: `grok-build:${id}`,
      name: id,
      provider: 'grok-build' as AIProviderType,
    }));
  }

  static getDefaultModel(): string {
    return DEFAULT_MODELS['grok-build'];
  }

  private static async listModelIds(): Promise<string[]> {
    const command = GrokBuildProvider.grokPathLoader?.() ?? 'grok';
    try {
      const { execFile } = await import('child_process');
      const output = await new Promise<string>((resolve, reject) => {
        execFile(command, ['models'], {
          timeout: 10_000,
          encoding: 'utf8',
          env: GrokBuildProvider.enhancedPathLoader
            ? { ...process.env, PATH: GrokBuildProvider.enhancedPathLoader() }
            : process.env,
        }, (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
      const ids = parseGrokModelList(output);
      if (ids.length > 0) return ids;
    } catch {
      // CLI missing or not runnable -- fall through to the default.
    }
    return [bareModelId(DEFAULT_MODELS['grok-build'])];
  }
}

/** Strip the `provider:` namespace the host uses from a stored model id. */
export function bareModelId(modelId: string): string {
  const separator = modelId.indexOf(':');
  return separator === -1 ? modelId : modelId.slice(separator + 1);
}

/**
 * Parse `grok models` output.
 *
 * ```
 * Default model: grok-4.6
 *
 * Available models:
 *   * grok-4.6 (default)
 *   - grok-4.5
 * ```
 */
export function parseGrokModelList(output: string): string[] {
  const ids: string[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*[*-]\s+(\S+)/.exec(line);
    if (match) ids.push(match[1]);
  }
  return [...new Set(ids)];
}
