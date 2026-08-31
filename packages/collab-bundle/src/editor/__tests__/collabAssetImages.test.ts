// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  acquireCollabAssetImageResolver,
  assetApiOrigin,
} from '../collabAssetImages';
import { asTeamJwt } from '../types';

const SRC = 'collab-asset://doc/doc-1/asset/asset-1';

function assetResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Collab-Asset-Format': 'plaintext.v1',
      'X-Collab-Asset-Mime-Type': 'image/png',
      ...init.headers,
    },
  });
}

/** Records the blob each object URL was minted from, so type is assertable. */
function objectUrlRecorder() {
  const blobs = new Map<string, Blob>();
  const revoked: string[] = [];
  let next = 0;
  return {
    blobs,
    revoked,
    createObjectUrl: (blob: Blob) => {
      const url = `blob:test/${next++}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectUrl: (url: string) => { revoked.push(url); },
  };
}

function lease(
  orgId: string,
  fetchImpl: typeof fetch,
  urls = objectUrlRecorder(),
  getTeamJwt = vi.fn(async () => asTeamJwt('team-jwt')),
) {
  return {
    urls,
    getTeamJwt,
    handle: acquireCollabAssetImageResolver({
      serverUrl: 'wss://sync.example.com',
      orgId,
      getTeamJwt,
      fetchImpl,
      createObjectUrl: urls.createObjectUrl,
      revokeObjectUrl: urls.revokeObjectUrl,
    }),
  };
}

describe('assetApiOrigin', () => {
  it('turns the room WebSocket origin into the asset API origin', () => {
    // Hosts pass the transport URL; the assets live on the http(s) twin.
    expect(assetApiOrigin('wss://sync.example.com')).toBe('https://sync.example.com');
    expect(assetApiOrigin('ws://localhost:8790')).toBe('http://localhost:8790');
    expect(assetApiOrigin('https://sync.example.com')).toBe('https://sync.example.com');
  });
});

describe('collab asset image resolver', () => {
  it('fetches with the team JWT and types the blob from the mime header', async () => {
    const fetchImpl = vi.fn(async () => assetResponse('png-bytes'));
    const { handle, urls, getTeamJwt } = lease('org-1', fetchImpl as unknown as typeof fetch);

    const resolved = await handle.resolve(SRC);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sync.example.com/api/collab/docs/doc-1/assets/asset-1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer team-jwt');
    expect(getTeamJwt).toHaveBeenCalledWith(undefined);
    // The body arrives as application/octet-stream; a blob typed from the
    // response instead of the header would never render as an image.
    expect(urls.blobs.get(resolved!)?.type).toBe('image/png');

    handle.release();
  });

  it('ignores anything that is not a collab-asset URI', async () => {
    const fetchImpl = vi.fn(async () => assetResponse('x'));
    const { handle } = lease('org-2', fetchImpl as unknown as typeof fetch);

    expect(await handle.resolve('https://example.com/a.png')).toBeNull();
    expect(await handle.resolve('images/a.png')).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    handle.release();
  });

  it('retries once with a fresh token when the session JWT expired', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(assetResponse('nope', { status: 401 }))
      .mockResolvedValueOnce(assetResponse('png-bytes'));
    const { handle, getTeamJwt } = lease('org-3', fetchImpl as unknown as typeof fetch);

    expect(await handle.resolve(SRC)).toMatch(/^blob:/);
    expect(getTeamJwt).toHaveBeenNthCalledWith(2, { forceRefresh: true });

    handle.release();
  });

  it('refuses a blob the server could not decode rather than rendering its bytes', async () => {
    const fetchImpl = vi.fn(async () => assetResponse('garbage', {
      headers: { 'X-Collab-Asset-Error-Code': 'asset_format_unreadable' },
    }));
    const { handle } = lease('org-4', fetchImpl as unknown as typeof fetch);

    expect(await handle.resolve(SRC)).toBeNull();

    handle.release();
  });

  it('does not cache a failure, so a later attempt can succeed', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(assetResponse('nope', { status: 500 }))
      .mockResolvedValueOnce(assetResponse('png-bytes'));
    const { handle } = lease('org-5', fetchImpl as unknown as typeof fetch);

    expect(await handle.resolve(SRC)).toBeNull();
    expect(await handle.resolve(SRC)).toMatch(/^blob:/);

    handle.release();
  });

  it('shares one fetch across open documents and only revokes on the last release', async () => {
    // Two document tabs in one org. The editor's image callbacks live in a
    // single module-level slot, so closing one tab must not pull the resolver
    // out from under the other.
    const fetchImpl = vi.fn(async () => assetResponse('png-bytes'));
    const first = lease('org-6', fetchImpl as unknown as typeof fetch);
    const second = lease('org-6', fetchImpl as unknown as typeof fetch, first.urls);

    const a = await first.handle.resolve(SRC);
    const b = await second.handle.resolve(SRC);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);

    first.handle.release();
    expect(first.urls.revoked).toEqual([]);
    expect(await second.handle.resolve(SRC)).toBe(a);

    second.handle.release();
    expect(first.urls.revoked).toEqual([a]);
  });
});
