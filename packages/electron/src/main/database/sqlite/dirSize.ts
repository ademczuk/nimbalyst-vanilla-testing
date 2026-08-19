/**
 * Recursive on-disk size, in bytes.
 *
 * Iterative rather than recursive so a pathological directory tree can't blow
 * the stack, and every filesystem error is swallowed per-entry: this feeds
 * pre-flight sizing and a telemetry gauge, neither of which should be able to
 * fail a launch because one file went away mid-walk.
 *
 * Returns 0 for a path that does not exist.
 */

import * as fs from 'fs';
import * as path from 'path';

export function dirSizeBytes(dir: string): number {
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const p = stack.pop()!;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(p);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(p);
      } catch {
        continue;
      }
      for (const e of entries) stack.push(path.join(p, e));
    } else if (stat.isFile()) {
      total += stat.size;
    }
  }
  return total;
}
