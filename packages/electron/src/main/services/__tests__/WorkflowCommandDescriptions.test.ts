import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../../');

function collectMarkdownFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const results: string[] = [];

  const walk = (currentPath: string) => {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  };

  walk(dirPath);
  return results.sort();
}

function hasDescriptionFrontmatter(filePath: string): boolean {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) {
    return false;
  }
  return /^description:\s*.+$/m.test(match[1]);
}

describe('workflow command metadata', () => {
  it('keeps project Claude commands described for export compatibility', () => {
    const commandFiles = collectMarkdownFiles(path.join(repoRoot, '.claude', 'commands'));
    const missing = commandFiles.filter((filePath) => !hasDescriptionFrontmatter(filePath));

    expect(missing).toEqual([]);
  });

  it('keeps built-in extension Claude plugin commands described', () => {
    const extensionRoot = path.join(repoRoot, 'packages', 'extensions');
    const pluginCommandFiles = collectMarkdownFiles(extensionRoot).filter((filePath) =>
      filePath.includes(`${path.sep}claude-plugin${path.sep}`) &&
      !filePath.endsWith(`${path.sep}SKILL.md`)
    );
    const missing = pluginCommandFiles.filter((filePath) => !hasDescriptionFrontmatter(filePath));

    expect(missing).toEqual([]);
  });

  // A command file that exists on disk but is missing from its manifest never
  // reaches the user: the plugin export walks the manifest, not the directory.
  // The failure is silent -- the file is right there, the command just isn't
  // offered -- so it is invisible in review and only shows up when someone
  // types the slash command and nothing happens.
  it('keeps each extension manifest in sync with its command files on disk', () => {
    const extensionRoot = path.join(repoRoot, 'packages', 'extensions');
    const drift: string[] = [];

    for (const entry of fs.readdirSync(extensionRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const manifestPath = path.join(extensionRoot, entry.name, 'manifest.json');
      const commandsDir = path.join(extensionRoot, entry.name, 'claude-plugin', 'commands');
      if (!fs.existsSync(manifestPath) || !fs.existsSync(commandsDir)) continue;

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
        contributions?: { claudePlugin?: { commands?: Array<{ name: string }> } };
      };
      const declared = (manifest.contributions?.claudePlugin?.commands ?? [])
        .map((c) => c.name)
        .sort();
      const onDisk = fs
        .readdirSync(commandsDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''))
        .sort();

      if (declared.join(',') !== onDisk.join(',')) {
        drift.push(`${entry.name}: manifest=[${declared.join(', ')}] disk=[${onDisk.join(', ')}]`);
      }
    }

    expect(drift).toEqual([]);
  });
});
