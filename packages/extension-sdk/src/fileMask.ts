/**
 * Comma-separated file mask matching, shared by Quick Open (renderer and main)
 * and the git extension's Changes filter so the syntax means the same thing
 * everywhere:
 *
 *   "*.ts,*.tsx"        — any .ts or .tsx file
 *   "src/** /*.test.ts" — recursive pattern
 *   "Ch0*.md"           — case-insensitive filename match
 *
 * Glob semantics: `*` matches any run of non-slash characters, `**` matches
 * anything (across slashes), `?` matches a single non-slash character. The
 * pattern is matched against both the basename and the full path so users can
 * write either `*.ts` or `src/*.ts` and get what they expect.
 */

function globToRegex(glob: string): RegExp {
  // Escape regex special chars except * and ?
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Convert glob wildcards: ** -> match any path, * -> match any non-slash, ? -> single non-slash
  const pattern = escaped
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${pattern}$`, 'i');
}

export function parseFileMask(mask: string | null | undefined): RegExp[] {
  if (!mask) return [];
  return mask
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(globToRegex);
}

export function matchesFileMask(filePath: string, patterns: RegExp[]): boolean {
  if (patterns.length === 0) return true;
  // Windows paths arrive back-slashed (main runs `path.normalize`). Without
  // this the basename split finds no separator, so the whole absolute path is
  // treated as the filename: `*.md` still matches it but `Ch0*.md` never can,
  // which is the extension-only filtering reported in #1196.
  const normalizedPath = filePath.replace(/\\/g, '/');
  const basename = normalizedPath.split('/').pop() ?? normalizedPath;
  return patterns.some((re) => re.test(basename) || re.test(normalizedPath));
}
