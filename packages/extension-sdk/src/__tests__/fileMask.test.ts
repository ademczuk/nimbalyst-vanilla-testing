// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseFileMask, matchesFileMask } from '../fileMask';

describe('fileMask', () => {
  it('matches a name glob against Windows back-slashed paths', () => {
    // #1196: main returns `path.normalize`d paths, so on Windows the mask sees
    // `C:\...\Ch01.md`. Before the separator normalization only `*.md` matched
    // (the whole path has no `/`), which read as "the mask filters by
    // extension only".
    const winPath = 'C:\\Users\\me\\book\\Ch01.md';
    expect(matchesFileMask(winPath, parseFileMask('Ch0*.md'))).toBe(true);
    expect(matchesFileMask(winPath, parseFileMask('*.md'))).toBe(true);
    expect(matchesFileMask(winPath, parseFileMask('Notes*.md'))).toBe(false);
    expect(matchesFileMask('C:\\Users\\me\\book\\notes.txt', parseFileMask('Ch0*.md'))).toBe(false);
  });

  it('matches names, directory globs and comma-separated lists on posix paths', () => {
    const patterns = parseFileMask('Ch0*.md, *.ts');
    expect(matchesFileMask('/Users/me/book/Ch01.md', patterns)).toBe(true);
    expect(matchesFileMask('/Users/me/book/index.ts', patterns)).toBe(true);
    expect(matchesFileMask('/Users/me/book/index.tsx', patterns)).toBe(false);

    // `*` stops at a separator, `**` crosses them, `?` is a single character.
    expect(matchesFileMask('src/a/b.test.ts', parseFileMask('src/*.test.ts'))).toBe(false);
    expect(matchesFileMask('src/a/b.test.ts', parseFileMask('src/**/*.test.ts'))).toBe(true);
    expect(matchesFileMask('src\\a\\b.test.ts', parseFileMask('src/**/*.test.ts'))).toBe(true);
    expect(matchesFileMask('Ch1.md', parseFileMask('Ch?.md'))).toBe(true);
    expect(matchesFileMask('Ch12.md', parseFileMask('Ch?.md'))).toBe(false);
  });

  it('treats an empty or absent mask as no filter', () => {
    expect(parseFileMask(undefined)).toEqual([]);
    expect(parseFileMask('  ,  ')).toEqual([]);
    expect(matchesFileMask('anything.bin', [])).toBe(true);
  });
});
