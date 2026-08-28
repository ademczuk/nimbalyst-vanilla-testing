// @vitest-environment node
/**
 * A provider that declares `'structured'` file-change fidelity has the
 * workspace watcher's attribution switched OFF. Something must replace it, and
 * that something is the `pre_edit_snapshot` / `post_edit_snapshot` chunks
 * `MessageStreamingHandler` turns into local-history tags.
 *
 * Get this wrong and the failure is silent in the worst way: the agent edits
 * files correctly, the transcript looks right, and the Files Edited sidebar is
 * simply empty. These tests exist because that is exactly what shipped in the
 * first draft of the Cursor provider.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { CursorAgentProvider } from '../CursorAgentProvider';
import { GrokBuildProvider } from '../GrokBuildProvider';
import { mapCursorRecord } from '../../protocols/CursorAgentProtocol';
import { mapGrokRecord } from '../../protocols/GrokBuildProtocol';
import type { StreamChunk } from '../../types';
import type { ProtocolEvent } from '../../protocols/ProtocolInterface';

const FIXTURE_DIR = path.join(__dirname, '..', '..', 'transcript', '__tests__', 'fixtures');
const WORKSPACE = '/private/tmp/acp-bakeoff-7zTW';

function fixtureEvents(name: string, map: (r: Record<string, unknown>) => ProtocolEvent[]) {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((l) => map(JSON.parse(l) as Record<string, unknown>));
}

/** Reach the protected generator without standing up a full provider turn. */
function snapshotsFor(provider: unknown, events: ProtocolEvent[]): StreamChunk[] {
  const build = (provider as {
    buildEditSnapshots(e: ProtocolEvent): Generator<StreamChunk>;
  }).buildEditSnapshots.bind(provider);
  return events.flatMap((e) => [...build(e)]);
}

describe('Cursor Agent edit snapshots', () => {
  const events = fixtureEvents('cursorAgentStreamJson.editTurn.ndjson', mapCursorRecord);
  const chunks = snapshotsFor(new CursorAgentProvider(), events);

  it('emits a pre-edit snapshot, because the watcher is switched off for it', () => {
    // The guard on the whole integration: 'structured' fidelity + no snapshot
    // means no tracked files at all.
    expect(new CursorAgentProvider().getFileChangeFidelity()).toBe('structured');
    expect(chunks.some((c) => c.type === 'pre_edit_snapshot')).toBe(true);
  });

  it('carries the file\'s real prior contents, marked authoritative', () => {
    // One snapshot per tool result, and Cursor completes the delete before the
    // edit -- so find the chunk for this path rather than taking the first.
    const pre = chunks.find(
      (c) => c.type === 'pre_edit_snapshot'
        && c.preEditSnapshot!.entries.some((e) => e.path.endsWith('alpha.txt')),
    )!;
    const entry = pre.preEditSnapshot!.entries.find((e) => e.path.endsWith('alpha.txt'));
    expect(entry?.content).toBe('line one\nline two\nline three\n');
    // Not authoritative => MessageStreamingHandler consults FileSnapshotCache,
    // which for a fresh session holds the POST-edit body and renders an
    // all-green diff.
    expect(pre.preEditSnapshot!.authoritative).toBe(true);
  });

  it('records a deleted file\'s baseline but gives it no post-state', () => {
    const pre = chunks.find(
      (c) => c.type === 'pre_edit_snapshot'
        && c.preEditSnapshot!.entries.some((e) => e.path.endsWith('doomed.txt')),
    );
    expect(pre?.preEditSnapshot!.entries.find((e) => e.path.endsWith('doomed.txt'))?.content)
      .toBe('delete me\n');

    const postPaths = chunks
      .filter((c) => c.type === 'post_edit_snapshot')
      .flatMap((c) => c.postEditSnapshot!.entries.map((e) => e.path));
    expect(postPaths.some((p) => p.endsWith('doomed.txt'))).toBe(false);
  });
});

describe('Grok Build edit snapshots', () => {
  it('emits none, because its "before" text is a fragment and not the file', () => {
    // Grok's diff block carries only the replaced substring. Writing that as a
    // baseline would diff the whole file against two words. Grok stays on
    // 'tool-args', keeps the watcher, and uses the pre-edit tag path instead.
    const events = fixtureEvents(
      'grokBuildStreamingJson.editTurn.ndjson',
      (r) => mapGrokRecord(r, WORKSPACE),
    );
    expect(snapshotsFor(new GrokBuildProvider(), events)).toEqual([]);
  });
});
