/**
 * Frontmatter-change detection for the document metadata cache.
 *
 * `extractFrontmatter` reports "no frontmatter" as `hash: null`, but
 * `fileStateCache` stores `hash?: string` and writes `hash || undefined`. A raw
 * `cachedState.hash !== hash` therefore compares `undefined` against `null` and
 * is true forever, so every save of a markdown file with no frontmatter looked
 * like a metadata change. That fires `document-service:metadata-changed`, which
 * the renderer's tracker data source answers with a full reload of every
 * tracker item -- measured at 5,698 items / 27 MB / ~400 ms, on every autosave
 * tick while typing.
 *
 * Both absent forms mean the same thing: this file has no frontmatter.
 */
export function frontmatterHashChanged(
  cached: string | null | undefined,
  next: string | null | undefined,
): boolean {
  return (cached ?? null) !== (next ?? null);
}
