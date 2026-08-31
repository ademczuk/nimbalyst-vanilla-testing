/**
 * Browser resolver for `collab-asset://` document attachments.
 *
 * The desktop app registers `collab-asset://` as a real Chromium protocol and
 * serves it from the main process. A browser cannot do that, so the bundle
 * resolves the URI itself: fetch the asset over the same HTTPS API the desktop
 * protocol handler uses, and hand the editor a `blob:` URL it can put in
 * `<img src>`. Without this every image in a shared document renders as the
 * broken-asset placeholder in the web console.
 *
 * Two details this cannot get wrong:
 *
 * - The response body is served as `application/octet-stream`; the real type
 *   is in `X-Collab-Asset-Mime-Type`. A blob built from the response's own
 *   Content-Type will not render as an image.
 * - `<img src>` cannot carry an Authorization header, which is why the bytes
 *   are fetched here (with the team JWT) rather than pointed at directly.
 */
import {
  COLLAB_ASSET_HEADER_ERROR_CODE,
  COLLAB_ASSET_HEADER_MIME,
  COLLAB_ASSET_HEADER_WIRE_FORMAT,
  COLLAB_ASSET_WIRE_FORMAT_PLAINTEXT,
} from '@nimbalyst/runtime/sync/collabAssetFormat';
import { parseCollabAssetUri } from '@nimbalyst/runtime/editor/utils/collabAssetUri';

import type { TeamJwt } from './types';

export interface CollabAssetImageResolverOptions {
  /**
   * The room's server origin. Hosts pass a WebSocket origin (the editor's
   * transport uses it), so `ws(s)://` is normalized to `http(s)://` here
   * rather than asking every call site to carry a second URL.
   */
  serverUrl: string;
  getTeamJwt: (options?: { forceRefresh?: boolean }) => Promise<TeamJwt>;
  /** Seams for tests; the browser's own implementations by default. */
  fetchImpl?: typeof fetch;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

export interface CollabAssetImageResolver {
  /** Returns a loadable URL, or null for anything this does not own. */
  resolve: (src: string) => Promise<string | null>;
  /** Revokes every object URL this resolver minted. */
  dispose: () => void;
}

export interface CollabAssetImageLease {
  resolve: (src: string) => Promise<string | null>;
  release: () => void;
}

/** `wss://sync.example.com` -> `https://sync.example.com`; https passes through. */
export function assetApiOrigin(serverUrl: string): string {
  const url = new URL(serverUrl);
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  return url.origin;
}

export function createCollabAssetImageResolver(
  options: CollabAssetImageResolverOptions,
): CollabAssetImageResolver {
  const {
    serverUrl,
    getTeamJwt,
    fetchImpl = fetch,
    createObjectUrl = (blob: Blob) => URL.createObjectURL(blob),
    revokeObjectUrl = (url: string) => URL.revokeObjectURL(url),
  } = options;

  const origin = assetApiOrigin(serverUrl);
  /**
   * One in-flight fetch and one object URL per asset URI. Keyed by URI because
   * the same image appears in the document as many times as the author pasted
   * it, and every `ImageComponent` resolves independently.
   */
  const inFlight = new Map<string, Promise<string | null>>();
  const minted = new Set<string>();
  let disposed = false;

  const fetchAsset = async (
    documentId: string,
    assetId: string,
    forceRefresh: boolean,
  ): Promise<Response> => {
    const jwt = await getTeamJwt(forceRefresh ? { forceRefresh: true } : undefined);
    return fetchImpl(
      `${origin}/api/collab/docs/${encodeURIComponent(documentId)}` +
        `/assets/${encodeURIComponent(assetId)}`,
      {
        headers: { Authorization: `Bearer ${jwt}` },
        credentials: 'omit',
      },
    );
  };

  const load = async (src: string): Promise<string | null> => {
    const parsed = parseCollabAssetUri(src);
    if (!parsed) return null;

    let response: Response;
    try {
      response = await fetchAsset(parsed.documentId, parsed.assetId, false);
      // A JWT that expired while the document stayed open is the one failure
      // worth a second attempt: mint a fresh one and ask again.
      if (response.status === 401 || response.status === 403) {
        response = await fetchAsset(parsed.documentId, parsed.assetId, true);
      }
    } catch {
      return null;
    }

    if (!response.ok) return null;
    // A blob the server cannot decode, or one it did not hand over as
    // plaintext, is not an image -- rendering its bytes would show garbage.
    if (response.headers.get(COLLAB_ASSET_HEADER_ERROR_CODE)) return null;
    const wireFormat =
      response.headers.get(COLLAB_ASSET_HEADER_WIRE_FORMAT) ??
      COLLAB_ASSET_WIRE_FORMAT_PLAINTEXT;
    if (wireFormat !== COLLAB_ASSET_WIRE_FORMAT_PLAINTEXT) return null;

    const mimeType =
      response.headers.get(COLLAB_ASSET_HEADER_MIME) || 'application/octet-stream';
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch {
      return null;
    }

    const objectUrl = createObjectUrl(new Blob([bytes], { type: mimeType }));
    if (disposed) {
      // The editor went away mid-fetch; nothing will ever load this.
      revokeObjectUrl(objectUrl);
      return null;
    }
    minted.add(objectUrl);
    return objectUrl;
  };

  return {
    resolve: (src: string) => {
      if (disposed || !src.startsWith('collab-asset://')) {
        return Promise.resolve(null);
      }
      const existing = inFlight.get(src);
      if (existing) return existing;

      const pending = load(src).then((resolved) => {
        // Only a success is worth keeping: a failure cached forever would
        // survive the reconnect that fixes it.
        if (!resolved) inFlight.delete(src);
        return resolved;
      });
      inFlight.set(src, pending);
      return pending;
    },
    dispose: () => {
      disposed = true;
      inFlight.clear();
      for (const url of minted) revokeObjectUrl(url);
      minted.clear();
    },
  };
}

interface SharedResolverEntry {
  resolver: CollabAssetImageResolver;
  getTeamJwt: (options?: { forceRefresh?: boolean }) => Promise<TeamJwt>;
  leases: number;
}

const sharedResolvers = new Map<string, SharedResolverEntry>();

/**
 * Take a refcounted share of the resolver for one org on one server.
 *
 * Per-mount resolvers would be wrong, because the editor's image callbacks live
 * in a single module-level slot that the most recent mount overwrites: closing
 * one document tab would dispose the resolver every *other* open tab is reading
 * through, and their images would start failing. Sharing also means a document
 * open in two tabs fetches each asset once.
 */
export function acquireCollabAssetImageResolver(
  options: CollabAssetImageResolverOptions & { orgId: string },
): CollabAssetImageLease {
  const key = `${assetApiOrigin(options.serverUrl)}|${options.orgId}`;
  let entry = sharedResolvers.get(key);
  if (!entry) {
    // The entry owns the indirection so a later lease can supply a fresher
    // token callback without rebuilding the resolver and losing its cache.
    const created: SharedResolverEntry = {
      getTeamJwt: options.getTeamJwt,
      leases: 0,
      resolver: createCollabAssetImageResolver({
        ...options,
        getTeamJwt: (jwtOptions) => created.getTeamJwt(jwtOptions),
      }),
    };
    entry = created;
    sharedResolvers.set(key, entry);
  }
  entry.getTeamJwt = options.getTeamJwt;
  entry.leases += 1;

  const held = entry;
  let released = false;
  return {
    resolve: (src) => held.resolver.resolve(src),
    release: () => {
      if (released) return;
      released = true;
      held.leases -= 1;
      if (held.leases > 0) return;
      sharedResolvers.delete(key);
      held.resolver.dispose();
    },
  };
}
