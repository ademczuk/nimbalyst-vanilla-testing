/**
 * Precedence for turning an `<img>` src stored in the document into something
 * the current host can actually load, for every src whose answer does not
 * depend on the DOM.
 *
 * The host resolver goes first, and that ordering is the whole point of this
 * module. `collab-asset://` used to short-circuit ahead of it because Electron
 * registers that scheme as a real protocol in main and needs the URI passed
 * through untouched -- but a browser has no such scheme, so in the web console
 * the URI reached `<img src>` verbatim and every shared-document image was
 * broken. Asking the host first lets the browser bundle claim the URI (it
 * fetches the asset and hands back a `blob:` URL) while Electron, which
 * registers no resolver, still falls through to the pass-through below.
 *
 * Relative paths and `.nimbalyst/assets/` hashes are deliberately not handled
 * here: they need the document path off the mounted DOM node, so they stay in
 * `ImageComponent`.
 */
import { localAssetUrl } from '../../../utils/localAssetUrl';

export interface ImageSrcResolutionCallbacks {
  resolveImageSrc?: (src: string) => Promise<string | null>;
}

export interface ResolvedImageSrc {
  src: string;
  /**
   * Whether the load cache keyed on the *original* src has to be dropped. A
   * host resolver can hand back a different URL for the same document src
   * (a re-minted blob URL, a re-resolved local path), and a cached failure
   * from the previous answer would otherwise stick.
   */
  evictCache: boolean;
}

/**
 * Resolve `src` when the answer is knowable without the DOM, or `null` when
 * the caller must fall back to document-relative resolution.
 */
export async function resolveKnownImageSrc(
  src: string,
  callbacks: ImageSrcResolutionCallbacks,
): Promise<ResolvedImageSrc | null> {
  if (callbacks.resolveImageSrc) {
    try {
      const resolved = await callbacks.resolveImageSrc(src);
      if (resolved) {
        return { src: resolved, evictCache: true };
      }
    } catch (error) {
      console.error('Failed to resolve image source', error);
    }
  }

  // No host resolver claimed it. In Electron the main process serves this
  // scheme itself, so the URI has to reach Chromium unchanged.
  if (src.startsWith('collab-asset://')) {
    return { src, evictCache: false };
  }

  // file:// needs to be re-routed through the platform's local-asset URL
  // (nim-asset:// in Electron). Other absolute URL schemes pass through.
  if (src.startsWith('file://')) {
    return { src: localAssetUrl(src.replace(/^file:\/\//, '')), evictCache: true };
  }

  if (/^(https?|data|blob):/.test(src)) {
    return { src, evictCache: false };
  }

  return null;
}
