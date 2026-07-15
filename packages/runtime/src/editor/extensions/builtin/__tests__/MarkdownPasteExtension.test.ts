import { describe, expect, it, vi } from 'vitest';

import { rewriteClipboardHtmlImages } from '../MarkdownPasteExtension';
import type { UploadedEditorAsset } from '../../../EditorConfig';

function imageFile(name = 'shot.png'): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'image/png' });
}

function uploader(uri = 'collab-asset://doc/d1/asset/a1') {
  return vi.fn(
    async (file: File): Promise<UploadedEditorAsset> => ({
      kind: 'image',
      src: uri,
      name: file.name,
      altText: file.name,
    }),
  );
}

describe('rewriteClipboardHtmlImages', () => {
  it('uploads a file-backed pasted image and rewrites it to a collab-asset URI', async () => {
    // Browser image copies ship the real bytes as a clipboard File alongside
    // HTML that references them via an ephemeral src (blob: / webkit-fake-url:).
    const html = '<img src="blob:https://app.local/abcd-1234">';
    const upload = uploader();

    const result = await rewriteClipboardHtmlImages(html, upload, [imageFile()]);

    expect(result).not.toBeNull();
    // The real bytes (the clipboard File), not a fetched blob URL, were uploaded.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBeInstanceOf(File);
    // Images-only paste inserts image nodes directly.
    expect(result!.html).toBeNull();
    expect(result!.imagePayloads).toHaveLength(1);
    expect(result!.imagePayloads[0].src).toBe('collab-asset://doc/d1/asset/a1');
  });

  it('leaves an external http image untouched when no bytes are present', async () => {
    // A bare <img src="https://..."> with no accompanying File is out of scope:
    // it still resolves from the remote and must not be auto-downloaded.
    const html = '<img src="https://example.com/remote.png">';
    const upload = uploader();

    const result = await rewriteClipboardHtmlImages(html, upload, []);

    expect(result).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });
});
