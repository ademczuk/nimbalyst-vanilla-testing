// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  prepareClaudeCodeAttachments,
  appendFailedAttachmentNotice,
} from '../messagePreparation';

// Regression coverage for nimbalyst#1389. jimp 1.6.1 moved @jimp/core onto
// file-type ^21, reached through `await import("file-type")`; rollup emitted
// that as a lazy chunk which re-entered the main bundle, and the second
// evaluation threw on electron-log double registration. compressImage relabelled
// it CorruptedImageError, and this function caught it and dropped the image
// block -- so the model answered "what is in this image?" having never received
// the image, with nothing in the UI to say so.
//
// The structural fixes live in the bundle (see
// scripts/main-bundle-require-policy.mjs). These tests pin the behaviour that
// keeps a future compression failure from being silent again.

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function withImageFile<T>(run: (filepath: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nim-1389-'));
  const filepath = path.join(dir, 'pasted-image-1.png');
  await fs.writeFile(filepath, PNG_BYTES);
  try {
    return await run(filepath);
  } finally {
    await fs.unlink(filepath).catch(() => {});
    await fs.rmdir(dir).catch(() => {});
  }
}

describe('prepareClaudeCodeAttachments image attachments (issue #1389)', () => {
  it('still sends the image when compression throws', async () => {
    const result = await withImageFile((filepath) =>
      prepareClaudeCodeAttachments({
        attachments: [{ type: 'image', filename: 'pasted-image-1.png', filepath }],
        largeAttachmentCharThreshold: 10_000,
        imageCompressor: async () => {
          throw new Error('Image data is corrupted or invalid');
        },
      }),
    );

    // The whole point: a failed optimisation must not cost the user the image.
    expect(result.imageContentBlocks).toHaveLength(1);
    expect(result.imageContentBlocks[0].source).toMatchObject({
      type: 'base64',
      media_type: 'image/png',
      data: PNG_BYTES.toString('base64'),
    });
    expect(result.failedAttachments).toEqual([]);
  });

  it('uses the compressed bytes when compression succeeds', async () => {
    const compressed = Buffer.from('compressed-jpeg-bytes');
    const result = await withImageFile((filepath) =>
      prepareClaudeCodeAttachments({
        attachments: [{ type: 'image', filename: 'pasted-image-1.png', filepath }],
        largeAttachmentCharThreshold: 10_000,
        imageCompressor: async () => ({
          buffer: compressed,
          mimeType: 'image/jpeg',
          wasCompressed: true,
        }),
      }),
    );

    expect(result.imageContentBlocks[0].source).toMatchObject({
      media_type: 'image/jpeg',
      data: compressed.toString('base64'),
    });
  });

  it('reports an attachment it could not read instead of dropping it silently', async () => {
    const result = await prepareClaudeCodeAttachments({
      attachments: [{
        type: 'image',
        filename: 'pasted-image-1.png',
        filepath: path.join(os.tmpdir(), 'nim-1389-does-not-exist', 'gone.png'),
      }],
      largeAttachmentCharThreshold: 10_000,
    });

    expect(result.imageContentBlocks).toHaveLength(0);
    expect(result.failedAttachments).toEqual(['pasted-image-1.png']);

    // And the model is told, so it cannot answer as if it had seen the image.
    const message = appendFailedAttachmentNotice('what is in this image?', result.failedAttachments);
    expect(message).toContain('pasted-image-1.png');
    expect(message).toContain('UNAVAILABLE_ATTACHMENTS');
  });

  it('leaves the message untouched when every attachment arrived', () => {
    expect(appendFailedAttachmentNotice('hello', [])).toBe('hello');
  });
});
