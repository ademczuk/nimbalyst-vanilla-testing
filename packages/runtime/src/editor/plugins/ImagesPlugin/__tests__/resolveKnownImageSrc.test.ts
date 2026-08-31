// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { resolveKnownImageSrc } from '../resolveKnownImageSrc';

const COLLAB_SRC = 'collab-asset://doc/doc-1/asset/asset-1';

describe('resolveKnownImageSrc', () => {
  it('lets a host resolver claim a collab-asset URI', async () => {
    // The web console's answer: it fetches the asset itself and returns a blob
    // URL. Before this ordering existed the URI short-circuited to `<img src>`
    // and no browser could load it.
    const resolveImageSrc = vi.fn().mockResolvedValue('blob:https://app/abc');

    expect(await resolveKnownImageSrc(COLLAB_SRC, { resolveImageSrc })).toEqual({
      src: 'blob:https://app/abc',
      evictCache: true,
    });
    expect(resolveImageSrc).toHaveBeenCalledWith(COLLAB_SRC);
  });

  it('passes a collab-asset URI through when no host resolver claims it', async () => {
    // Electron: main serves the scheme, so the URI must reach Chromium intact.
    expect(await resolveKnownImageSrc(COLLAB_SRC, {})).toEqual({
      src: COLLAB_SRC,
      evictCache: false,
    });
    expect(
      await resolveKnownImageSrc(COLLAB_SRC, {
        resolveImageSrc: async () => null,
      }),
    ).toEqual({ src: COLLAB_SRC, evictCache: false });
  });

  it('falls back to pass-through when the host resolver throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolveImageSrc = vi.fn().mockRejectedValue(new Error('offline'));

    expect(await resolveKnownImageSrc(COLLAB_SRC, { resolveImageSrc })).toEqual({
      src: COLLAB_SRC,
      evictCache: false,
    });
    consoleError.mockRestore();
  });

  it('routes file:// through the local-asset converter and passes web schemes', async () => {
    expect(await resolveKnownImageSrc('file:///tmp/a.png', {})).toEqual({
      src: 'file:///tmp/a.png',
      evictCache: true,
    });
    expect(await resolveKnownImageSrc('https://example.com/a.png', {})).toEqual({
      src: 'https://example.com/a.png',
      evictCache: false,
    });
  });

  it('returns null for a document-relative path so the caller resolves it against the DOM', async () => {
    expect(await resolveKnownImageSrc('images/a.png', {})).toBeNull();
  });
});
