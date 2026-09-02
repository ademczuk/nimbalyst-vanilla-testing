/**
 * The suffix -> Monaco language map, and the textual suffixes derived from it.
 *
 * This lived in two places until the web console needed it: `getMonacoLanguage`
 * in `monacoUtils.ts` held one copy for language selection, and
 * `MONACO_LANGUAGE_BY_EXTENSION` in the electron renderer's `fileTypeDetector`
 * held another for the collaborative document-type catalog. They had drifted by
 * two entries (`.dart`, `.mdc`), which is the harmless version of a divergence
 * that decides whether a shared file is openable at all.
 *
 * It lives here rather than in the electron package because the browser host
 * needs the same answer: the console registers Monaco as `builtin.monaco` and
 * has to declare which suffixes that editor claims *before* any bundle loads.
 * A second copy over there would be the same bug with a worse failure mode --
 * a suffix the desktop shares and the console reports unopenable.
 */

/**
 * Textual suffixes understood by the built-in Monaco editor, mapped to the
 * Monaco language id used to highlight them.
 */
export const MONACO_LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  // JavaScript/TypeScript
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.d.ts': 'typescript',

  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',

  // Data formats
  '.json': 'json',
  '.jsonc': 'json',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',

  // Python
  '.py': 'python',
  '.pyw': 'python',
  '.pyi': 'python',

  // Shell
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',

  // C/C++
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',

  // Other compiled languages
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.cs': 'csharp',
  '.dart': 'dart',

  // Scripting
  '.rb': 'ruby',
  '.php': 'php',
  '.pl': 'perl',
  '.lua': 'lua',

  // Functional
  '.hs': 'haskell',
  '.scala': 'scala',
  '.clj': 'clojure',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',

  // Markup/config
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdc': 'markdown',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.dockerfile': 'dockerfile',
  '.dockerignore': 'plaintext',
  '.gitignore': 'plaintext',
  '.env': 'plaintext',

  // Text
  '.txt': 'plaintext',
  '.log': 'plaintext',
});

/** Longest suffix first so compound types such as `.d.ts` win. */
export const MONACO_TEXT_FILE_EXTENSIONS: readonly string[] = Object.freeze(
  Object.keys(MONACO_LANGUAGE_BY_EXTENSION).sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  ),
);

/**
 * Suffixes the collaborative `code` document type claims.
 *
 * Markdown is excluded because it is its own collaborative type, backed by
 * Lexical rather than Monaco. `.mdc` goes with it: it renders as markdown, so
 * letting the code type claim it would give one suffix two owners.
 */
export const CODE_COLLAB_FILE_EXTENSIONS: string[] =
  MONACO_TEXT_FILE_EXTENSIONS.filter(
    (suffix) => suffix !== '.md' && suffix !== '.markdown' && suffix !== '.mdc',
  );
