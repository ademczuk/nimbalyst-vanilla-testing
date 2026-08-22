import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface OpenCodeModelCatalogIdentityOptions {
  enhancedPath: string;
  configPath: string;
  workspacePath?: string;
  xdgDataHome?: string;
  configuredApiKey?: string | null;
  platform?: NodeJS.Platform;
  arch?: string;
  homedir?: string;
}

/**
 * Build an opaque cache identity without persisting credentials. The binary is
 * represented by its real path and stat tuple; auth/config inputs are hashed so
 * adding a provider credential or changing provider config invalidates the
 * cached catalog immediately.
 */
export async function createOpenCodeModelCatalogCacheKey(
  options: OpenCodeModelCatalogIdentityOptions
): Promise<string> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const homedir = options.homedir ?? os.homedir();
  const binaryPath = resolveOpenCodeExecutable(options.enhancedPath, platform);
  const authPath = path.join(
    options.xdgDataHome || path.join(homedir, '.local', 'share'),
    'opencode',
    'auth.json'
  );

  const [binaryIdentity, authDigest, configDigest] = await Promise.all([
    describeBinary(binaryPath),
    digestFile(authPath),
    digestFile(options.configPath),
  ]);
  const settingsKeyDigest = options.configuredApiKey
    ? createHash('sha256').update(options.configuredApiKey).digest('hex')
    : 'missing';

  return `v2:${createHash('sha256')
    .update(
      JSON.stringify({
        platform,
        arch,
        binaryIdentity,
        authDigest,
        configDigest,
        settingsKeyDigest,
        workspacePath: options.workspacePath
          ? path.resolve(options.workspacePath)
          : 'unscoped',
      })
    )
    .digest('hex')}`;
}

export function resolveOpenCodeExecutable(
  enhancedPath: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  const executableNames =
    platform === 'win32'
      ? ['opencode.exe', 'opencode.cmd', 'opencode.bat', 'opencode']
      : ['opencode'];

  for (const entry of enhancedPath.split(path.delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!directory) continue;
    for (const executableName of executableNames) {
      const candidate = path.join(directory, executableName);
      if (fsSync.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function describeBinary(binaryPath: string | null): Promise<string> {
  if (!binaryPath) return 'missing';
  try {
    const [realPath, stat] = await Promise.all([
      fs.realpath(binaryPath),
      fs.stat(binaryPath),
    ]);
    return `${realPath}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `unreadable:${binaryPath}`;
  }
}

async function digestFile(filePath: string): Promise<string> {
  try {
    const contents = await fs.readFile(filePath);
    return createHash('sha256').update(contents).digest('hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    return 'unreadable';
  }
}
