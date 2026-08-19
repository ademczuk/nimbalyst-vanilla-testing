#!/usr/bin/env node
/**
 * Reports which marketplace extensions need shipping, by comparing each local
 * manifest against what is actually live on the CDN.
 *
 * The registry alone is not enough. Two failures this catches that a version
 * comparison does not:
 *
 *   - A committed fix sits unpublished because nobody bumped the version, so
 *     local and live agree numerically while the shipped bundle is stale.
 *   - The published bundle's collaboration declaration disagrees with the local
 *     manifest. That is how a mockup project stayed advertised as shareable
 *     after the local manifest had gated it off -- users on the old build could
 *     still share into a broken path.
 *
 * Usage:
 *   node scripts/marketplace-status.mjs            # report
 *   node scripts/marketplace-status.mjs --check    # exit 1 if anything needs shipping
 *   node scripts/marketplace-status.mjs --no-bundles  # skip downloading published bundles
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MARKETPLACE_DIR = path.resolve(SCRIPT_DIR, '..');
const REGISTRY_URL = 'https://extensions.nimbalyst.com/registry';

// --- pure helpers (unit-tested) -------------------------------------------

export function parseReleaseList(contents) {
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [relativePath, ...flags] = line.split('|');
      return { relativePath, skipBuild: flags.includes('skip-build') };
    });
}

export function compareVersions(a, b) {
  const rank = (v) => String(v ?? '0').split('.').map((p) => parseInt(p, 10) || 0);
  const x = rank(a);
  const y = rank(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] || 0) - (y[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Maps each custom-editor file pattern to whether it declares collaboration. */
export function collaborationByPattern(manifest) {
  const editors = (manifest?.contributions ?? {}).customEditors ?? [];
  const result = {};
  for (const editor of editors) {
    for (const pattern of editor.filePatterns ?? []) {
      result[pattern] = Boolean(editor.collaboration?.supported);
    }
  }
  return result;
}

/**
 * Collaboration declarations that differ between the local manifest and the
 * bundle currently on the CDN. `published: true, local: false` is the
 * dangerous direction -- users are being offered a share path we withdrew.
 */
export function collaborationDrift(localManifest, publishedManifest) {
  const local = collaborationByPattern(localManifest);
  const published = collaborationByPattern(publishedManifest);
  const drift = [];
  for (const pattern of new Set([...Object.keys(local), ...Object.keys(published)])) {
    const l = local[pattern] ?? false;
    const p = published[pattern] ?? false;
    if (l !== p) drift.push({ pattern, local: l, published: p });
  }
  return drift;
}

export function classify({ localVersion, liveVersion, sourceChanged, collabDrift }) {
  if (!liveVersion) return 'never published';
  const cmp = compareVersions(localVersion, liveVersion);
  if (cmp > 0) return 'publish (already bumped)';
  if (cmp < 0) return 'LOCAL BEHIND LIVE';
  if (collabDrift?.length) return 'bump+publish (collab drift)';
  if (sourceChanged) return 'bump+publish';
  return 'up to date';
}

export const NEEDS_SHIPPING = new Set([
  'never published',
  'publish (already bumped)',
  'bump+publish',
  'bump+publish (collab drift)',
  'LOCAL BEHIND LIVE',
]);

// --- git / io --------------------------------------------------------------

/**
 * Trailing-only trim: `git status --porcelain` encodes the status in the first
 * two columns, so stripping leading whitespace would shift every path by one.
 */
function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).replace(/\s+$/, '');
  } catch {
    return '';
  }
}

/**
 * True when the extension's own source changed after the commit that set its
 * current version -- i.e. a fix is committed but was never released. Ignores
 * manifest-only commits so a bump itself does not look like pending work.
 */
function hasUnreleasedSource(extensionDir, version) {
  const repo = git(extensionDir, ['rev-parse', '--show-toplevel']);
  if (!repo) return { changed: false, detail: 'not a git repo' };

  const relDir = path.relative(repo, extensionDir) || '.';
  const relManifest = path.join(relDir, 'manifest.json');

  // A pending version bump is not pending work -- it IS the release. Count
  // only changes to something other than the manifest.
  const uncommitted = git(repo, ['status', '--porcelain', '--', relDir])
    .split('\n')
    .filter(Boolean)
    .filter((line) => line.slice(3).trim() !== relManifest);

  const versionCommit = git(repo, [
    'log', '-1', '--format=%H', '-S', `"version": "${version}"`, '--', relManifest,
  ]);

  let commits = [];
  if (versionCommit) {
    commits = git(repo, ['log', '--format=%H', `${versionCommit}..HEAD`, '--', relDir])
      .split('\n')
      .filter(Boolean)
      // Only count commits that touched something other than the manifest.
      .filter((sha) => {
        const files = git(repo, ['show', '--name-only', '--format=', sha, '--', relDir])
          .split('\n')
          .filter(Boolean);
        return files.some((f) => f !== relManifest);
      });
  }

  const parts = [];
  if (commits.length) parts.push(`${commits.length} commit(s)`);
  if (uncommitted.length) parts.push(`${uncommitted.length} uncommitted`);
  return {
    changed: commits.length > 0 || uncommitted.length > 0,
    detail: parts.join(', ') || (versionCommit ? '' : 'version commit not found'),
  };
}

function fetchJson(url) {
  const out = execFileSync('curl', ['-sL', '--max-time', '30', url], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function fetchPublishedManifest(downloadUrl) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nimbalyst-marketplace-status-'));
  try {
    const archive = path.join(dir, 'ext.nimext');
    const bytes = execFileSync('curl', ['-sL', '--max-time', '60', downloadUrl], {
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
    });
    writeFileSync(archive, bytes);
    execFileSync('unzip', ['-o', '-q', archive, 'manifest.json', '-d', dir]);
    return JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- main ------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const checkMode = args.includes('--check');
  const withBundles = !args.includes('--no-bundles');

  const releaseList = parseReleaseList(
    readFileSync(path.join(MARKETPLACE_DIR, 'release-extensions.txt'), 'utf8'),
  );

  let live;
  try {
    live = new Map(fetchJson(REGISTRY_URL).extensions.map((e) => [e.id, e]));
  } catch (error) {
    console.error(`Could not reach the live registry (${error.message}).`);
    process.exit(2);
  }

  const rows = [];
  for (const { relativePath } of releaseList) {
    const dir = path.resolve(MARKETPLACE_DIR, relativePath);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      rows.push({ id: relativePath, status: 'MANIFEST MISSING', notes: [dir] });
      continue;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = live.get(manifest.id);
    const source = hasUnreleasedSource(dir, manifest.version);

    // Note: an extension's package.json `version` is not maintained in this
    // repo -- manifest.json is the only source of truth -- so it is not
    // compared here.
    const notes = [];

    let drift = [];
    const declaresCollab = Object.values(collaborationByPattern(manifest)).some(Boolean)
      || Object.keys(collaborationByPattern(manifest)).length > 0;
    if (withBundles && entry && declaresCollab) {
      const published = fetchPublishedManifest(entry.downloadUrl);
      if (published) {
        drift = collaborationDrift(manifest, published);
        for (const d of drift) {
          notes.push(
            `${d.pattern}: local collab=${d.local}, published collab=${d.published}`
            + (d.published && !d.local ? '  <-- live build offers a withdrawn share path' : ''),
          );
        }
      } else {
        notes.push('could not read published bundle');
      }
    }

    if (source.detail) notes.push(source.detail);

    rows.push({
      id: manifest.id,
      local: manifest.version,
      live: entry?.version ?? '-',
      status: classify({
        localVersion: manifest.version,
        liveVersion: entry?.version,
        sourceChanged: source.changed,
        collabDrift: drift,
      }),
      notes,
    });
  }

  const pending = rows.filter((r) => NEEDS_SHIPPING.has(r.status));
  const width = Math.max(...rows.map((r) => r.id.length));

  if (pending.length) {
    console.log('Needs shipping:\n');
    for (const r of pending.sort((a, b) => a.id.localeCompare(b.id))) {
      console.log(`  ${r.id.padEnd(width)}  local ${String(r.local).padEnd(7)} live ${String(r.live).padEnd(7)} ${r.status}`);
      for (const note of r.notes) console.log(`  ${' '.repeat(width)}    ${note}`);
    }
    console.log('');
  }

  const clean = rows.length - pending.length;
  console.log(`${clean} up to date, ${pending.length} need shipping.`);
  if (!withBundles) console.log('(collaboration drift not checked -- ran with --no-bundles)');

  if (checkMode && pending.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
