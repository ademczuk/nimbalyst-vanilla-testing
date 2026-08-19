// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deriveIssueKeyPrefix, resolveLocalKeyPrefix } from '../trackerIssueKeyPrefix';

describe('deriveIssueKeyPrefix', () => {
  it('uses the first three project-name letters', () => {
    expect(deriveIssueKeyPrefix('/Users/dev/stravu-editor')).toBe('STR');
    expect(deriveIssueKeyPrefix('Nimbalyst')).toBe('NIM');
  });

  it('ignores separators, punctuation, numbers, and accents', () => {
    expect(deriveIssueKeyPrefix('my-project')).toBe('MYP');
    expect(deriveIssueKeyPrefix('2026 Ångström')).toBe('ANG');
    expect(deriveIssueKeyPrefix('C:\\src\\road-party')).toBe('ROA');
  });

  it('keeps valid two-letter names and falls back for shorter names', () => {
    expect(deriveIssueKeyPrefix('/projects/AI')).toBe('AI');
    expect(deriveIssueKeyPrefix('/projects/x')).toBe('NIM');
    expect(deriveIssueKeyPrefix('123')).toBe('NIM');
  });
});

describe('resolveLocalKeyPrefix', () => {
  /**
   * Sibling folders all derive the same three letters, and a local number
   * carries no other hint of which project it came from. Two projects sharing
   * a prefix is what makes `NIM.4` ambiguous on one machine.
   */
  it('gives sibling projects distinct prefixes', () => {
    const pinned: string[] = [];
    for (const project of ['nimbalyst-code', 'nimbalyst-collab', 'nimbalyst-website']) {
      pinned.push(resolveLocalKeyPrefix({ projectNameOrPath: `/src/${project}`, takenPrefixes: pinned }));
    }

    expect(pinned).toEqual(['NIM', 'NIC', 'NIW']);
  });

  it('takes the plain derived prefix when nothing else holds it', () => {
    expect(resolveLocalKeyPrefix({ projectNameOrPath: '/src/stravu-editor' })).toBe('STR');
  });

  it('falls past word initials to later letters, then an alphabet sweep', () => {
    // Every word-initial candidate for `road-party` (ROA, ROP) is spoken for,
    // so allocation moves on rather than reusing one.
    expect(
      resolveLocalKeyPrefix({ projectNameOrPath: 'road-party', takenPrefixes: ['ROA', 'ROP'] }),
    ).toBe('ROD');

    const everything = ['ROA', 'ROP', 'ROD', 'ROT', 'ROY', 'ROR'];
    expect(everything).not.toContain(
      resolveLocalKeyPrefix({ projectNameOrPath: 'road-party', takenPrefixes: everything }),
    );
  });

  it('is case-insensitive about what is already taken', () => {
    expect(
      resolveLocalKeyPrefix({ projectNameOrPath: '/src/nimbalyst-collab', takenPrefixes: ['nim'] }),
    ).toBe('NIC');
  });
});
