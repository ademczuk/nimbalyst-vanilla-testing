// @vitest-environment node
/**
 * Exercised against a real `node -e` child rather than a mocked stream: the
 * properties that matter here (chunk boundaries mid-line, a missing trailing
 * newline, stderr surfacing on a bad exit, teardown on abort) are all
 * properties of the actual process plumbing, and a fake stream would assert
 * only that the fake behaves as written.
 */
import { describe, it, expect } from 'vitest';
import {
  runHeadlessNdjson,
  HeadlessNdjsonExitError,
  type HeadlessNdjsonItem,
} from '../headless/HeadlessNdjsonProcess';

async function collect(script: string, abortSignal?: AbortSignal): Promise<HeadlessNdjsonItem[]> {
  const items: HeadlessNdjsonItem[] = [];
  for await (const item of runHeadlessNdjson({
    command: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    abortSignal,
  })) {
    items.push(item);
  }
  return items;
}

describe('runHeadlessNdjson', () => {
  it('reassembles records split across chunk boundaries', async () => {
    // Both CLIs emit long lines (a whole-file diff), so a record reliably
    // straddles more than one stdout chunk.
    const script = `
      process.stdout.write('{"type":"a"}\\n{"ty');
      setTimeout(() => process.stdout.write('pe":"b"}\\n{"type":"c"}\\n'), 10);
    `;
    const items = await collect(script);
    expect(items.map((i) => (i.kind === 'record' ? i.value.type : i.line)))
      .toEqual(['a', 'b', 'c']);
  });

  it('yields the last record when the process exits without a trailing newline', async () => {
    const items = await collect(`process.stdout.write('{"type":"only"}')`);
    expect(items).toEqual([{ kind: 'record', value: { type: 'only' } }]);
  });

  it('reports non-JSON lines as garbage instead of aborting the turn', async () => {
    // A CLI that prints a banner or a warning to stdout must not kill the run.
    const script = `process.stdout.write('warning: something\\n{"type":"a"}\\n[1,2]\\n')`;
    const items = await collect(script);
    expect(items).toEqual([
      { kind: 'garbage', line: 'warning: something' },
      { kind: 'record', value: { type: 'a' } },
      { kind: 'garbage', line: '[1,2]' },
    ]);
  });

  it('throws with the tail of stderr on a non-zero exit', async () => {
    // This is what turns an opaque empty turn into "you are not logged in".
    const script = `
      process.stderr.write('Not logged in\\n');
      process.exit(3);
    `;
    await expect(collect(script)).rejects.toThrow(HeadlessNdjsonExitError);
    await expect(collect(script)).rejects.toThrow(/code 3[\s\S]*Not logged in/);
  });

  it('stops cleanly when aborted mid-stream, without a spurious exit error', async () => {
    const controller = new AbortController();
    const script = `
      process.stdout.write('{"type":"a"}\\n');
      setInterval(() => {}, 1000);
    `;
    const items: HeadlessNdjsonItem[] = [];
    for await (const item of runHeadlessNdjson({
      command: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      abortSignal: controller.signal,
    })) {
      items.push(item);
      controller.abort();
    }
    // A killed process exits non-zero; a user-requested cancel is not an error.
    expect(items).toEqual([{ kind: 'record', value: { type: 'a' } }]);
  });
});
