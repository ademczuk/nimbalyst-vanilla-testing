import { describe, expect, it } from 'vitest';
import {
  parseTrackerReferenceHref,
  resolveTranscriptFilePathFromHref,
  resolveTranscriptFileTargetFromHref,
  transcriptUrlTransform,
} from '../MarkdownRenderer';

describe('resolveTranscriptFilePathFromHref', () => {
  it('resolves unix absolute file paths', () => {
    expect(resolveTranscriptFilePathFromHref('/Users/test/project/src/file.ts')).toBe(
      '/Users/test/project/src/file.ts'
    );
  });

  it('strips line and column suffixes from file paths', () => {
    expect(resolveTranscriptFilePathFromHref('/Users/test/project/src/file.ts:42:7')).toBe(
      '/Users/test/project/src/file.ts'
    );
  });

  it('resolves file:// links and decodes path segments', () => {
    expect(resolveTranscriptFilePathFromHref('file:///Users/test/My%20Project/prompt.ts')).toBe(
      '/Users/test/My Project/prompt.ts'
    );
  });

  it('decodes percent-encoded spaces in a plain unix path (NIM-964)', () => {
    // `encodeMarkdownLinkPath` produces this form; the href react-markdown
    // hands back must decode to the real on-disk path with a space.
    expect(resolveTranscriptFilePathFromHref('/Users/test/My%20Project/design.md')).toBe(
      '/Users/test/My Project/design.md'
    );
  });

  it('decodes percent-encoded spaces and parens in a Windows drive path (NIM-964)', () => {
    expect(
      resolveTranscriptFilePathFromHref('/D:/Program%20Files%20%28x86%29/App/notes%20file.md')
    ).toBe('D:/Program Files (x86)/App/notes file.md');
  });

  it('returns null for external web links', () => {
    expect(resolveTranscriptFilePathFromHref('https://nimbalyst.com/docs')).toBeNull();
  });

  it('returns null for non-absolute local paths', () => {
    expect(resolveTranscriptFilePathFromHref('src/ai/prompt.ts')).toBeNull();
  });

  // Claude Code emits markdown links with an `/abs/path/` prefix on
  // top of the real filesystem path. The reporter on #240 confirmed
  // these links failed to open on Windows because the literal path
  // does not exist. Strip the prefix before the absolute-path check
  // so the IPC handler receives the real on-disk path.
  it('strips /abs/path/ prefix on Windows-style paths', () => {
    expect(
      resolveTranscriptFilePathFromHref('/abs/path/C:/Users/test/project/src/file.ts')
    ).toBe('C:/Users/test/project/src/file.ts');
  });

  it('strips /abs/path/ prefix and line:column suffix on Windows-style paths', () => {
    expect(
      resolveTranscriptFilePathFromHref('/abs/path/C:/Users/test/project/src/file.ts:236')
    ).toBe('C:/Users/test/project/src/file.ts');
  });

  it('strips /abs/path/ prefix on macOS-style paths', () => {
    expect(
      resolveTranscriptFilePathFromHref('/abs/path//Users/test/project/src/file.ts')
    ).toBe('/Users/test/project/src/file.ts');
  });

  it('strips /abs/path/ prefix with line:column on macOS-style paths', () => {
    expect(
      resolveTranscriptFilePathFromHref('/abs/path//Users/test/project/src/file.ts:42:7')
    ).toBe('/Users/test/project/src/file.ts');
  });

  it('returns null when /abs/path/ wraps a non-absolute remainder', () => {
    // After stripping the prefix we have `relative/file.ts` which is not
    // an absolute filesystem path, so the renderer should leave it for
    // the default link handler rather than route it through workspace
    // file-open.
    expect(
      resolveTranscriptFilePathFromHref('/abs/path/relative/file.ts')
    ).toBeNull();
  });

  it('leaves non-/abs/path/ absolute paths untouched', () => {
    expect(
      resolveTranscriptFilePathFromHref('/Users/test/normal/file.ts')
    ).toBe('/Users/test/normal/file.ts');
  });

  // Windows bug (GitHub #744): drive-letter absolute paths were mishandled.
  // `D:\...` / `D:/...` look like a `d:` URI scheme and were rejected as
  // external links (opening a blank window); `/D:/...` passed through with a
  // spurious leading slash and failed with "File does not exist".
  it('resolves Windows drive-letter paths with backslashes', () => {
    expect(
      resolveTranscriptFilePathFromHref('D:\\work\\INCOMLibrary\\Source\\icThemes.pas')
    ).toBe('D:\\work\\INCOMLibrary\\Source\\icThemes.pas');
  });

  it('resolves Windows drive-letter paths with forward slashes', () => {
    expect(
      resolveTranscriptFilePathFromHref('D:/work/INCOMLibrary/Source/icThemes.pas')
    ).toBe('D:/work/INCOMLibrary/Source/icThemes.pas');
  });

  it('strips a spurious leading slash before a Windows drive letter', () => {
    expect(
      resolveTranscriptFilePathFromHref('/D:/work/INCOMLibrary/Source/icThemes.pas')
    ).toBe('D:/work/INCOMLibrary/Source/icThemes.pas');
  });

  it('strips line:column suffixes from Windows drive-letter paths', () => {
    expect(
      resolveTranscriptFilePathFromHref('D:/work/Source/icThemes.pas:42:7')
    ).toBe('D:/work/Source/icThemes.pas');
  });
});

describe('transcriptUrlTransform', () => {
  it('preserves Windows drive-letter paths that the default transform would blank', () => {
    expect(transcriptUrlTransform('D:\\work\\Source\\icThemes.pas')).toBe(
      'D:\\work\\Source\\icThemes.pas'
    );
    expect(transcriptUrlTransform('D:/work/Source/icThemes.pas')).toBe(
      'D:/work/Source/icThemes.pas'
    );
  });

  it('preserves leading-slash drive-letter and UNC paths', () => {
    expect(transcriptUrlTransform('/D:/work/Source/icThemes.pas')).toBe(
      '/D:/work/Source/icThemes.pas'
    );
    expect(transcriptUrlTransform('\\\\server\\share\\file.pas')).toBe(
      '\\\\server\\share\\file.pas'
    );
  });

  it('preserves POSIX absolute and relative paths', () => {
    expect(transcriptUrlTransform('/Users/test/file.ts')).toBe('/Users/test/file.ts');
    expect(transcriptUrlTransform('src/ai/prompt.ts')).toBe('src/ai/prompt.ts');
  });

  it('still allows safe external protocols', () => {
    expect(transcriptUrlTransform('https://nimbalyst.com/docs')).toBe(
      'https://nimbalyst.com/docs'
    );
  });

  it('still sanitizes dangerous protocols', () => {
    expect(transcriptUrlTransform('javascript:alert(1)')).toBe('');
  });

  // Tracker reference links (`nimbalyst://NIM-123`) were blanked by the default
  // transform (unknown protocol), so the tracker-chip check in the `a` renderer
  // never saw the href and the link opened a blank window on click.
  it('preserves nimbalyst:// tracker reference URNs', () => {
    expect(transcriptUrlTransform('nimbalyst://NIM-1315')).toBe(
      'nimbalyst://NIM-1315'
    );
  });
});

describe('parseTrackerReferenceHref', () => {
  it('accepts tracker issue-key and local-id URNs only', () => {
    expect(parseTrackerReferenceHref('nimbalyst://NIM-123')).toBe('NIM-123');
    expect(parseTrackerReferenceHref('nimbalyst://tk_a1b2c3')).toBe('tk_a1b2c3');
    expect(
      parseTrackerReferenceHref('nimbalyst://action/open-project-manager'),
    ).toBeNull();
    expect(parseTrackerReferenceHref('nimbalyst://doc/document-1')).toBeNull();
  });
});

describe('resolveTranscriptFileTargetFromHref', () => {
  it('keeps the line and column a link carried', () => {
    expect(resolveTranscriptFileTargetFromHref('/Users/test/src/file.ts:42:7')).toEqual({
      path: '/Users/test/src/file.ts',
      line: 42,
      column: 7,
    });
  });

  it('keeps a bare line with no column', () => {
    expect(
      resolveTranscriptFileTargetFromHref('/Users/test/plans/design.md:653')
    ).toEqual({ path: '/Users/test/plans/design.md', line: 653 });
  });

  it('reports no location when the link has no suffix', () => {
    expect(resolveTranscriptFileTargetFromHref('/Users/test/src/file.ts')).toEqual({
      path: '/Users/test/src/file.ts',
    });
  });

  // A Windows drive colon sits at the front, not the end, so the end-anchored
  // suffix match must leave it alone -- otherwise `D:/work/x.ts` loses its drive.
  it('does not mistake a Windows drive letter for a location', () => {
    expect(resolveTranscriptFileTargetFromHref('D:/work/Source/icThemes.pas')).toEqual({
      path: 'D:/work/Source/icThemes.pas',
    });
    expect(resolveTranscriptFileTargetFromHref('D:/work/Source/icThemes.pas:42:7')).toEqual({
      path: 'D:/work/Source/icThemes.pas',
      line: 42,
      column: 7,
    });
  });

  it('keeps the location through the Claude Code /abs/path/ prefix', () => {
    expect(
      resolveTranscriptFileTargetFromHref('/abs/path//Users/test/src/file.ts:236')
    ).toEqual({ path: '/Users/test/src/file.ts', line: 236 });
  });

  // A zero line would be clamped to 1 downstream and scroll somewhere the link
  // never pointed at, so no location is reported. The path keeps its
  // pre-existing shape -- the suffix is still stripped, as it always was.
  it('reports no location for an implausible line number', () => {
    expect(resolveTranscriptFileTargetFromHref('/Users/test/src/file.ts:0')).toEqual({
      path: '/Users/test/src/file.ts',
    });
  });

  it('still returns null for external links', () => {
    expect(resolveTranscriptFileTargetFromHref('https://nimbalyst.com/docs')).toBeNull();
  });
});
