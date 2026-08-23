/**
 * The shared collaborative-comment UI, re-exported for browser extension hosts.
 *
 * On desktop an extension reaches these components through the renderer's
 * import map, which hands it the host's already-loaded module. A browser has no
 * import map: the console resolves the extension's externalized
 * `@nimbalyst/runtime/editor/commenting/ui` specifier to this entry instead
 * (see the alias in `packages/web-console/vite.config.ts`).
 *
 * It has to be *this* entry and not the runtime source directly. The console
 * compiles the console app and each pinned extension in one Rollup build, so an
 * entry both reach is hoisted into a single shared chunk — one module instance,
 * the same guarantee the desktop import map gives. Aliasing straight at
 * `../runtime/src/...` would instead compile a second private copy for the
 * extension: today that only duplicates stateless components and a stylesheet,
 * but the moment anything under `commenting/` grows module-level state (the
 * anchor-adapter and controller registries next door already have it) the
 * extension would be writing into one instance while the host read another,
 * and it would fail silently.
 *
 * `commenting/ui/index.ts` imports `comments.css` as a side effect, so the
 * stylesheet lands in this package's single `dist/styles.css` — already loaded
 * by `CollabDocumentSurface`. Extensions must not import CSS themselves.
 */
export * from './internal/runtime/src/editor/commenting/ui/index';
