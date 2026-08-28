/**
 * Policy for how the Electron main-process bundle may use `require`.
 *
 * Two related hazards, both of which have shipped:
 *
 * 1. `conf` (via electron-store) contains `delete require.cache[__filename]`.
 *    In its own module that removes only conf's entry. Inlined into our bundle,
 *    `__filename` is the main entry, so the entry evicts ITSELF from the module
 *    cache during startup.
 * 2. Rollup splits any dynamic `import()` reached from main into a lazy chunk,
 *    and those chunks `require("../index.js")` to reach shared bindings. With
 *    the entry missing from `require.cache`, that re-evaluates the whole main
 *    bundle a second time, which re-registers electron-log and throws
 *    "Attempted to register a second handler for '__ELECTRON_LOG__'".
 *
 * Together they turn any lazy chunk into a landmine. jimp 1.6.1 stepped on it:
 * `@jimp/core` moved to `file-type ^21` and now does `await import("file-type")`
 * inside `Jimp.fromBuffer`, so every image compression threw and every pasted
 * image was silently dropped from Claude Code sessions (#1389).
 *
 * These functions are pure so the decision is testable without a build; the
 * vite plugin in electron.vite.config.ts applies and enforces them.
 */

/**
 * Matches `delete require.cache[__filename]`, tolerating whitespace and the
 * optional trailing semicolon so a reformat or a minifier pass does not slip
 * past the gate.
 */
export const REQUIRE_CACHE_SELF_EVICTION =
  /delete\s+require\s*\.\s*cache\s*\[\s*__filename\s*\]\s*;?/g;

export function findRequireCacheSelfEviction(code) {
  return code.match(new RegExp(REQUIRE_CACHE_SELF_EVICTION.source, 'g')) ?? [];
}

/**
 * Remove the self-eviction. The statement is inert here: conf's own comment
 * says it keeps `module.parent` accurate, but `module.parent` is bound when the
 * module loads and is unaffected by a later cache delete — and in the bundle it
 * is read in the very next statement of the same evaluation.
 */
export function stripRequireCacheSelfEviction(code) {
  const hits = findRequireCacheSelfEviction(code);
  if (hits.length === 0) return { code, count: 0 };
  return {
    // `void 0;` keeps the statement position valid inside the try block.
    code: code.replace(new RegExp(REQUIRE_CACHE_SELF_EVICTION.source, 'g'), 'void 0;'),
    count: hits.length,
  };
}

/**
 * Find emitted chunks that re-enter a top-level entry. `entryNames` are the
 * bundle's entry basenames without extension (e.g. ['index']).
 */
export function findChunksReenteringEntry(chunks, entryNames) {
  if (entryNames.length === 0) return [];
  const alternation = entryNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // Chunks are emitted one directory below the entries, so the specifier is
  // `../<entry>.js` for both `require(...)` and `from "..."` forms.
  const pattern = new RegExp(
    String.raw`(?:require\s*\(|from\s*)\s*["'](\.\.\/(?:${alternation})\.js)["']`,
    'g',
  );
  const violations = [];
  for (const { fileName, code } of chunks) {
    const specifiers = new Set();
    for (const match of code.matchAll(pattern)) specifiers.add(match[1]);
    if (specifiers.size > 0) {
      violations.push({ fileName, specifiers: [...specifiers] });
    }
  }
  return violations;
}
