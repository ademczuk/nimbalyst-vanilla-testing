// @vitest-environment node
/**
 * What a drop onto the board is allowed to turn into.
 *
 * The interesting failures here are all silent. A drop that stores an absolute
 * path produces a card that works perfectly on the machine that made it and is
 * broken for everyone else -- and `.canvas` is a file that goes in git, so
 * "everyone else" includes the author on their other laptop. A drop that
 * accepts an arbitrary `DataTransfer` payload writes whatever a page put there
 * into a persisted reference. Neither shows up on screen.
 */
import { describe, expect, it } from 'vitest';

import {
  readCanvasDrop,
  workspaceRelativeDropPath,
} from '../canvasDropSource';

const FILE_TYPE = 'application/x-nimbalyst-file-mention';
const DOC_TYPE = 'application/x-nimbalyst-collab-document';

function transfer(entries: Record<string, string>) {
  return { getData: (type: string) => entries[type] ?? '' };
}

describe('canvas drop source', () => {
  it('rebases a dropped path onto the workspace and refuses anything outside it', () => {
    expect(workspaceRelativeDropPath('/ws/docs/UI.md', '/ws')).toBe('docs/UI.md');
    // Windows separators reach here too; the stored reference is always POSIX.
    expect(workspaceRelativeDropPath('C:\\ws\\docs\\UI.md', 'C:\\ws')).toBe(
      'docs/UI.md'
    );

    // A card can only name something the workspace resolves. Storing these
    // would produce a reference that is broken everywhere but one machine.
    expect(workspaceRelativeDropPath('/elsewhere/secret.md', '/ws')).toBeNull();
    expect(workspaceRelativeDropPath('/ws', '/ws')).toBeNull();
    expect(workspaceRelativeDropPath('/ws/docs/UI.md', null)).toBeNull();
    // A sibling directory whose name merely starts with the workspace path.
    expect(workspaceRelativeDropPath('/ws-other/UI.md', '/ws')).toBeNull();
  });

  it('reads a shared document in preference to a path, and labels it by title', () => {
    const pick = readCanvasDrop(
      transfer({
        [DOC_TYPE]: JSON.stringify({
          orgId: 'org 1',
          documentId: 'doc/9',
          title: 'Launch plan',
        }),
        [FILE_TYPE]: '/ws/docs/UI.md',
      }),
      '/ws'
    );
    // Both components are encoded: an org or document id containing a slash
    // would otherwise re-parse as a different address entirely.
    expect(pick).toEqual({
      reference: { kind: 'doc', uri: 'nimbalyst://doc/org%201/doc%2F9' },
      label: 'Launch plan',
    });
  });

  it('reads a workspace file when that is all the drag carries', () => {
    expect(readCanvasDrop(transfer({ [FILE_TYPE]: '/ws/docs/UI.md' }), '/ws')).toEqual(
      {
        reference: { kind: 'file', path: 'docs/UI.md' },
        label: 'UI.md',
      }
    );
  });

  it('refuses a drag it cannot make a real reference out of', () => {
    // Nothing it recognises.
    expect(readCanvasDrop(transfer({ 'text/plain': 'hello' }), '/ws')).toBeNull();
    // Recognised type, unusable payload. The parse is defensive because a
    // DataTransfer is an open channel -- any page can write under this type.
    expect(readCanvasDrop(transfer({ [DOC_TYPE]: 'not json' }), '/ws')).toBeNull();
    expect(
      readCanvasDrop(transfer({ [DOC_TYPE]: JSON.stringify({ orgId: 'o' }) }), '/ws')
    ).toBeNull();
    // Outside the workspace: refused rather than stored absolute.
    expect(readCanvasDrop(transfer({ [FILE_TYPE]: '/etc/hosts' }), '/ws')).toBeNull();
  });
});
