#!/usr/bin/env node
/**
 * Compile a document's React components into the markup its parts draw.
 *
 * React is the authoring language; static markup is the artifact. Nothing
 * renders a component at play time -- this script runs it once with the props
 * the document carries and writes the result into that part's existing `html`
 * field. The editor preview, `export_html`, the GIF/MP4 recorder and a host
 * with no filesystem then all keep drawing the same string, which is the only
 * reason they agree frame for frame. A component resolved at render time would
 * have to be resolved four separate ways, and one of the four has no `fs`.
 *
 * What it writes, per part, and nothing else:
 *
 *   html      the rendered markup, sanitizer-clean
 *   subParts  the animatable regions the markup actually declared
 *   build     hashes of the props and of the component's own sources
 *
 * It never invents a part, a step or a coordinate. Its inputs come out of the
 * document, so the document stays the artifact and this stays a formatter.
 *
 *   node tools/anim-compile.mjs <doc.anim.json> [--theme <name>] [--check]
 *
 * `--theme` restamps `stage.theme` from the project's own `theme.ts`, which is
 * a one-field edit that needs no recompile of anything -- compiled markup
 * references token *names*, never literal colours.
 *
 * `--check` reports what would change and exits non-zero instead of writing,
 * which is what a pre-commit hook or a CI job wants.
 *
 * v1 deliberately runs from a checkout of this repository: it bundles the
 * extension's own `parse`/`serialize`/`sanitizeHtml` out of `../src/core` so
 * the canonical writer here and the one the editor saves with cannot drift.
 * Making it work from an installed extension means either shipping a bundled
 * copy of those modules or moving the compile into a backend module, and the
 * latter is blocked on a JSX transform small enough to bundle.
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = resolve(HERE, "../src/core");

/** Resolve esbuild from wherever this repo keeps it. */
async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    fail(
      "esbuild is not resolvable. Run this from a checkout with the repo's " +
        "node_modules installed."
    );
  }
}

function fail(message) {
  process.stderr.write(`anim-compile: ${message}\n`);
  process.exit(1);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Hash props independently of how they happen to be written.
 *
 * Key order is not meaning here, so sorting keeps a reformat from reading as a
 * change. This is the one staleness signal every consumer can check with no
 * filesystem at all, which is why it is computed from the document alone.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// ---- markup inspection ----------------------------------------------------

/**
 * Namespace a component's regions under the part that hosts them.
 *
 * A component emits a bare `data-part="sync"` because it does not know -- and
 * must not know -- which animation it was dropped into. Prefixing here is what
 * makes the id globally addressable as `b1Chrome/sync` while keeping the
 * component a pure function of its props.
 */
function prefixSubParts(markup, partId) {
  return markup.replace(
    /\bdata-part="([^"]*)"/g,
    (whole, id) => `data-part="${partId}/${id}"`
  );
}

/**
 * Read back the regions the markup declares, in DOM order.
 *
 * Rebuilt from the output on every compile rather than trusted from the
 * document, because a `subParts` entry that outlives the region it names is
 * exactly how a step goes silently inert.
 */
function collectSubParts(markup, partId, previous = {}) {
  const out = {};
  const tag = /<[a-zA-Z][^>]*\bdata-part="([^"]*)"[^>]*>/g;
  for (const match of markup.matchAll(tag)) {
    const full = match[1];
    if (!full.startsWith(`${partId}/`)) continue;
    const id = full.slice(partId.length + 1);
    const spec = {};
    // `label` has no channel in the markup -- it is the author's name for a
    // region, not the component's -- so it survives a recompile as long as the
    // region does. Everything else is read back from what was just rendered.
    if (previous[id]?.label) spec.label = previous[id].label;
    const tone = /\bdata-tone="([^"]*)"/.exec(match[0]);
    const state = /\bdata-state="([^"]*)"/.exec(match[0]);
    if (tone) spec.tone = tone[1];
    if (state) spec.state = state[1];
    out[id] = spec;
  }
  return out;
}

/** The first element's inline style, for the opaque-container lint. */
function rootStyle(markup) {
  const open = /<[a-zA-Z][^>]*>/.exec(markup);
  if (!open) return "";
  const style = /\bstyle="([^"]*)"/.exec(open[0]);
  return style ? style[1] : "";
}

// ---- the compile ----------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const docArg = args.find((a) => !a.startsWith("--"));
  if (!docArg) fail("usage: anim-compile.mjs <doc.anim.json> [--theme <name>] [--check]");
  const check = args.includes("--check");
  const themeIndex = args.indexOf("--theme");
  const themeName = themeIndex === -1 ? null : args[themeIndex + 1];
  if (themeIndex !== -1 && !themeName) fail("--theme needs a theme name");

  const docPath = isAbsolute(docArg) ? docArg : resolve(process.cwd(), docArg);
  if (!existsSync(docPath)) fail(`no such file: ${docPath}`);
  const docDir = dirname(docPath);
  const original = await readFile(docPath, "utf8");

  const esbuild = await loadEsbuild();
  const work = await mkdtemp(join(tmpdir(), "anim-compile-"));

  try {
    const core = await bundleCore(esbuild, work);
    const { doc, extras, problems } = core.parseDocument(original);

    const errors = problems.filter((p) => p.level === "error");
    if (errors.length > 0) {
      for (const p of errors) process.stderr.write(`  error ${p.path}: ${p.message}\n`);
      fail("the document does not parse cleanly; nothing compiled");
    }

    const warnings = [];
    const notes = [];
    const componentDirs = new Set();
    let compiled = 0;

    for (const [partId, part] of Object.entries(doc.parts)) {
      if (part.type !== "html" || !part.component) continue;

      const componentPath = resolve(docDir, part.component);
      if (!existsSync(componentPath)) {
        fail(`${partId}: no such component ${part.component}`);
      }

      componentDirs.add(dirname(componentPath));
      const built = await bundleComponent(esbuild, work, componentPath, compiled);
      const props = part.props ?? {};

      let raw;
      try {
        raw = built.module.render(props);
      } catch (error) {
        fail(`${partId}: ${part.component} threw while rendering: ${error?.message ?? error}`);
      }

      const markup = prefixSubParts(raw, partId);

      // Lint 1: the markup has to survive the sanitizer unchanged. Anything
      // dropped here vanishes silently on the stage, which is a blank rectangle
      // and half an hour of squinting at a screenshot.
      const clean = core.sanitizeHtml(markup);
      if (clean !== markup) {
        process.stderr.write(
          `  ${partId}: markup does not survive sanitizeHtml.\n` +
            `    rendered:  ${firstDifference(markup, clean)}\n`
        );
        fail(
          `${partId}: the component emits markup the stage would strip ` +
            "(an unlisted tag, an event handler, or an unsafe style)."
        );
      }

      // Lint 2: drawOrder paints every edge before every non-edge part, so an
      // opaque container root hides all nested edges with no error anywhere.
      const style = rootStyle(markup);
      if (/(^|;)\s*background(-color)?\s*:\s*(?!none|transparent)/i.test(style)) {
        warnings.push(
          `${partId}: the container root paints an opaque background, which ` +
            "will hide any edge drawn underneath it."
        );
      }

      // Lint 3: a component can declare its natural box, and a part sized away
      // from it is the documented way flex content silently overflows `h` and
      // collides with whatever is drawn below.
      const natural = built.module.size;
      if (natural && (natural.w !== part.w || natural.h !== part.h)) {
        warnings.push(
          `${partId}: ${part.component} declares size ${natural.w}x${natural.h} ` +
            `but the part is ${part.w}x${part.h}.`
        );
      }

      const subParts = collectSubParts(markup, partId, part.subParts ?? {});
      part.html = markup;
      if (Object.keys(subParts).length > 0) part.subParts = subParts;
      else delete part.subParts;
      part.build = {
        props: sha256(canonicalJson(props)),
        source: built.sourceHash,
      };
      // A component part draws from `html`; leaving `htmlFile` set would mean
      // the partial silently wins over what was just compiled.
      if (part.htmlFile) {
        warnings.push(`${partId}: htmlFile is set and takes precedence over the compiled html.`);
      }
      compiled += 1;
      notes.push(
        `${partId} <- ${part.component} (${markup.length} bytes` +
          `${Object.keys(subParts).length > 0 ? `, ${Object.keys(subParts).length} sub-parts` : ""})`
      );
    }

    if (themeName) {
      const themes = await loadThemes(esbuild, work, doc, docDir);
      if (!themes[themeName]) {
        fail(
          `theme "${themeName}" is not exported by the project's theme module ` +
            `(have: ${Object.keys(themes).join(", ") || "none"})`
        );
      }
      doc.stage.theme = themes[themeName];
      notes.push(`stage.theme <- ${themeName}`);
      // An explicit background override outranks the theme's own `bg`, so a
      // restamp that looks like it did nothing to the backdrop did exactly what
      // the document told it to.
      if (doc.stage.background) {
        warnings.push(
          `stage.background is set to ${doc.stage.background} and still wins ` +
            `over the theme's bg (${themes[themeName].bg ?? "unset"}).`
        );
      }
    }

    // Lint 3: every step assignment resolves against what was just compiled.
    // Without this the feature's characteristic failure is total silence.
    const targets = new Set(Object.keys(doc.parts));
    for (const [id, part] of Object.entries(doc.parts)) {
      for (const subId of Object.keys(part.subParts ?? {})) targets.add(`${id}/${subId}`);
    }
    const unresolved = [];
    for (const step of doc.steps) {
      for (const target of Object.keys(step.set ?? {})) {
        if (!targets.has(target)) unresolved.push(`step "${step.id}" sets "${target}"`);
      }
    }
    if (unresolved.length > 0) {
      for (const line of unresolved) process.stderr.write(`  ${line}\n`);
      fail("steps address parts or sub-parts that do not exist; nothing written");
    }

    // Lint 5: `tsc --noEmit` over the components, so an authoring agent gets a
    // real error signal instead of a blank rectangle on the stage. Best effort:
    // a project with no typescript installed still gets its markup compiled.
    if (componentDirs.size > 0) {
      const failure = await typecheck([...componentDirs]);
      if (failure) {
        process.stderr.write(failure);
        fail("the components do not typecheck; nothing written");
      }
    }

    const output = core.serializeDocument(doc, extras);

    for (const note of notes) process.stdout.write(`  ${note}\n`);
    for (const warning of warnings) process.stdout.write(`  warning: ${warning}\n`);

    if (output === original) {
      process.stdout.write("anim-compile: already up to date\n");
      return;
    }
    if (check) {
      process.stderr.write("anim-compile: out of date; run without --check\n");
      process.exit(2);
    }
    await writeFile(docPath, output, "utf8");
    process.stdout.write(
      `anim-compile: wrote ${relative(process.cwd(), docPath)} (${compiled} component parts)\n`
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Run `tsc --noEmit` over the component directories.
 *
 * Returns the compiler's output on failure, or null when it passed -- or when
 * there is no `tsc` to run, because an author without a TypeScript install
 * should still get their markup compiled.
 */
async function typecheck(dirs) {
  const { spawn } = await import("node:child_process");
  const files = [];
  const { readdir } = await import("node:fs/promises");
  for (const dir of dirs) {
    for (const name of await readdir(dir)) {
      if (/\.tsx?$/.test(name)) files.push(join(dir, name));
    }
  }
  if (files.length === 0) return null;

  return new Promise((done) => {
    const child = spawn(
      "npx",
      [
        "--no-install",
        "tsc",
        "--noEmit",
        "--strict",
        "--jsx", "react-jsx",
        "--target", "es2022",
        "--module", "esnext",
        "--moduleResolution", "bundler",
        "--skipLibCheck",
        ...files,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", () => done(null));
    child.on("close", (code) => done(code === 0 ? null : out));
  });
}

/** The first place two strings diverge, with a little context each side. */
function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return `…${a.slice(Math.max(0, i - 40), i + 60)}…`;
}

/**
 * The extension's own document reader and writer.
 *
 * Bundled from source rather than reimplemented: the whole point of
 * `serialize.ts` is that a hand edit and an editor save produce byte-identical
 * output, and a second canonical writer here would break exactly that.
 */
async function bundleCore(esbuild, work, cache = {}) {
  if (cache.core) return cache.core;
  const out = join(work, "core.mjs");
  await esbuild.build({
    stdin: {
      contents: `
        export { parseDocument } from "./parse";
        export { serializeDocument } from "./serialize";
        export { sanitizeHtml } from "./sanitizeHtml";
      `,
      resolveDir: CORE,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href);
}

/**
 * Bundle one component into something callable, plus a hash of its sources.
 *
 * The entry does the rendering itself so there is exactly one React in play.
 * `resolveDir` is the component's own directory, so `react` and
 * `react/jsx-runtime` resolve out of the *project's* node_modules -- the
 * extension deliberately has no runtime dependencies and must not become the
 * place a user's components resolve from.
 */
async function bundleComponent(esbuild, work, componentPath, index) {
  const out = join(work, `component-${index}.mjs`);
  const spec = JSON.stringify(componentPath);
  const result = await esbuild.build({
    stdin: {
      contents: `
        import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import * as mod from ${spec};

        function pick() {
          if (typeof mod.default === "function") return mod.default;
          const fns = Object.entries(mod).filter(([, v]) => typeof v === "function");
          if (fns.length === 1) return fns[0][1];
          const named = fns.find(([k]) => /^[A-Z]/.test(k));
          if (named) return named[1];
          throw new Error(
            "no component export found (expected a default export or one " +
            "capitalised function export)"
          );
        }

        export function render(props) {
          return renderToStaticMarkup(createElement(pick(), props ?? {}));
        }

        export const size = mod.size;
      `,
      resolveDir: dirname(componentPath),
      loader: "tsx",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    outfile: out,
    metafile: true,
    logLevel: "silent",
    // react-dom/server is CommonJS and reaches for node builtins through a
    // require() esbuild leaves intact. Without a `require` in scope the ESM
    // bundle throws "Dynamic require of util is not supported" on import.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });

  // Hash the component's own sources, transitively -- not the bundle, which
  // would churn on every React upgrade and say nothing about the component.
  const inputs = Object.keys(
    result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].inputs
  )
    // `<stdin>` is the generated entry, which is this script's own doing and
    // says nothing about the component.
    .filter((p) => !p.includes("node_modules") && p !== "<stdin>")
    .sort();
  const hash = createHash("sha256");
  for (const input of inputs) {
    hash.update(input);
    hash.update("\0");
    hash.update(await readFile(resolve(process.cwd(), input), "utf8"));
  }

  return {
    module: await import(pathToFileURL(out).href),
    sourceHash: hash.digest("hex").slice(0, 16),
  };
}

/**
 * The project's palettes, for `--theme`.
 *
 * Read from the project's own `theme.ts`, beside its components, so the
 * extension never has to know what themes exist or who made them.
 */
async function loadThemes(esbuild, work, doc, docDir) {
  const componentRef = Object.values(doc.parts).find(
    (p) => p.type === "html" && p.component
  )?.component;
  if (!componentRef) fail("--theme needs at least one component part to locate theme.ts");
  const themePath = resolve(dirname(resolve(docDir, componentRef)), "theme.ts");
  if (!existsSync(themePath)) fail(`--theme needs ${themePath}`);

  const out = join(work, "theme.mjs");
  await esbuild.build({
    entryPoints: [themePath],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(out).href);
  return mod.themes ?? {};
}

await main();
