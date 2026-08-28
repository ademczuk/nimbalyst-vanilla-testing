import path from 'path';
import fs from 'fs';
import os from 'os';
import type { DocumentBlockParam, ImageBlockParam } from '@anthropic-ai/sdk/resources';
import { buildUserMessageAddition } from '../documentContextUtils';
import type { DocumentContext } from '../../types';
import { stageLargeTextAttachment } from '../../attachments/stageLargeTextAttachment';
import type { AttachmentStagingMode } from '../../attachments/stagedAttachmentRegistry';

export interface LargeAttachmentFileRef {
  filename: string;
  filepath: string;
}

export interface PreparedClaudeAttachments {
  imageContentBlocks: ImageBlockParam[];
  documentContentBlocks: DocumentBlockParam[];
  largeAttachmentFilePaths: LargeAttachmentFileRef[];
  /**
   * Attachments that could not be turned into a content block at all. The model
   * is told about these so it can say the file did not arrive rather than
   * answering as though it had seen it. #1389
   */
  failedAttachments: string[];
}

interface PrepareAttachmentsOptions {
  attachments?: any[];
  largeAttachmentCharThreshold: number;
  imageCompressor?: (
    buffer: Buffer,
    mimeType: string,
    options?: { targetSizeBytes?: number }
  ) => Promise<{ buffer: Buffer; mimeType: string; wasCompressed: boolean }>;
  stagingRoot?: string;
  stagingMode?: AttachmentStagingMode;
  sessionId?: string;
}

export async function prepareClaudeCodeAttachments(
  options: PrepareAttachmentsOptions
): Promise<PreparedClaudeAttachments> {
  const {
    attachments,
    largeAttachmentCharThreshold,
    imageCompressor,
    stagingRoot = os.tmpdir(),
    stagingMode,
    sessionId,
  } = options;

  const imageContentBlocks: ImageBlockParam[] = [];
  const documentContentBlocks: DocumentBlockParam[] = [];
  const largeAttachmentFilePaths: LargeAttachmentFileRef[] = [];
  const failedAttachments: string[] = [];

  if (!attachments || attachments.length === 0) {
    return { imageContentBlocks, documentContentBlocks, largeAttachmentFilePaths, failedAttachments };
  }

  for (const attachment of attachments) {
    if (attachment.type === 'image' && attachment.filepath) {
      try {
        let imageData = await fs.promises.readFile(attachment.filepath);
        let mimeType = attachment.mimeType || 'image/png';

        if (imageCompressor) {
          // Compression is an optimization, not a precondition. Sending the
          // original bytes is always better than sending no image at all --
          // dropping the block here is how a bundling regression turned every
          // pasted screenshot into silence. #1389
          try {
            const compressed = await imageCompressor(imageData, mimeType);
            imageData = Buffer.from(compressed.buffer);
            mimeType = compressed.mimeType;
          } catch (error) {
            console.warn(
              '[CLAUDE-CODE] Image compression failed, sending original bytes:',
              error
            );
          }
        }

        const base64Data = imageData.toString('base64');
        let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/png';
        const normalizedMime = mimeType.toLowerCase();
        if (normalizedMime === 'image/jpeg' || normalizedMime === 'image/jpg') {
          mediaType = 'image/jpeg';
        } else if (normalizedMime === 'image/gif') {
          mediaType = 'image/gif';
        } else if (normalizedMime === 'image/webp') {
          mediaType = 'image/webp';
        } else if (normalizedMime === 'image/png') {
          mediaType = 'image/png';
        }

        imageContentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: base64Data,
          },
        });
      } catch (error) {
        console.error('[CLAUDE-CODE] Failed to read image attachment:', error);
        failedAttachments.push(attachment.filename || path.basename(attachment.filepath));
      }
      continue;
    }

    if (attachment.type === 'pdf' && attachment.filepath) {
      try {
        const pdfData = await fs.promises.readFile(attachment.filepath);
        const base64Data = pdfData.toString('base64');
        const filename = attachment.filename || path.basename(attachment.filepath);
        documentContentBlocks.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64Data,
          },
          title: filename,
        } as DocumentBlockParam);
      } catch (error) {
        console.error('[CLAUDE-CODE] Failed to read PDF attachment:', error);
        failedAttachments.push(attachment.filename || path.basename(attachment.filepath));
      }
      continue;
    }

    if (attachment.type === 'document' && attachment.filepath) {
      try {
        const textContent = await fs.promises.readFile(attachment.filepath, 'utf-8');
        const filename = attachment.filename || path.basename(attachment.filepath);

        if (textContent.length > largeAttachmentCharThreshold) {
          const tmpFilePath = await stageLargeTextAttachment(
            textContent,
            filename,
            stagingRoot,
            { sessionId, mode: stagingMode },
          );
          largeAttachmentFilePaths.push({ filename, filepath: tmpFilePath });
        } else {
          documentContentBlocks.push({
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: textContent,
            },
            title: filename,
          });
        }
      } catch (error) {
        console.error('[CLAUDE-CODE] Failed to read document attachment:', error);
        failedAttachments.push(attachment.filename || path.basename(attachment.filepath));
      }
    }
  }

  return { imageContentBlocks, documentContentBlocks, largeAttachmentFilePaths, failedAttachments };
}

interface BuildMessageWithDocumentContextOptions {
  message: string;
  isSlashCommand: boolean;
  documentContextPrompt?: string;
  editingInstructions?: string;
}

export function buildMessageWithDocumentContext(
  options: BuildMessageWithDocumentContextOptions
): { messageWithContext: string; userMessageAddition: string | null } {
  const { message, isSlashCommand, documentContextPrompt, editingInstructions } = options;

  if (isSlashCommand) {
    return {
      messageWithContext: message,
      userMessageAddition: null,
    };
  }

  const contextResult = buildUserMessageAddition(message, {
    documentContextPrompt,
    editingInstructions,
  } as DocumentContext);
  return {
    messageWithContext: contextResult.messageWithContext,
    userMessageAddition: contextResult.userMessageAddition,
  };
}

export function appendLargeAttachmentInstructions(
  message: string,
  largeAttachmentFilePaths: LargeAttachmentFileRef[]
): string {
  if (largeAttachmentFilePaths.length === 0) {
    return message;
  }

  const attachmentSection = largeAttachmentFilePaths
    .map(({ filename, filepath }) => `- ${filename}: ${filepath}`)
    .join('\n');

  const attachmentInstructions = `<LARGE_ATTACHMENTS>\nThe following attached files are too large to include inline. Use the Read tool to access their contents:\n${attachmentSection}\n</LARGE_ATTACHMENTS>`;

  if (message.includes('</NIMBALYST_SYSTEM_MESSAGE>')) {
    return message.replace(
      '</NIMBALYST_SYSTEM_MESSAGE>',
      `\n\n${attachmentInstructions}\n</NIMBALYST_SYSTEM_MESSAGE>`
    );
  }

  return `${message}\n\n<NIMBALYST_SYSTEM_MESSAGE>\n${attachmentInstructions}\n</NIMBALYST_SYSTEM_MESSAGE>`;
}

/**
 * Tell the model which attachments never made it into the request. Without this
 * a dropped image is indistinguishable from no image, and the model answers as
 * though it had seen the picture. #1389
 */
export function appendFailedAttachmentNotice(
  message: string,
  failedAttachments: string[]
): string {
  if (failedAttachments.length === 0) {
    return message;
  }

  const list = failedAttachments.map((filename) => `- ${filename}`).join('\n');
  const notice = `<UNAVAILABLE_ATTACHMENTS>\nThe user attached the following files, but they could not be delivered to you and are NOT present in this message:\n${list}\nDo not guess at their contents. Tell the user the attachment did not come through.\n</UNAVAILABLE_ATTACHMENTS>`;

  if (message.includes('</NIMBALYST_SYSTEM_MESSAGE>')) {
    return message.replace(
      '</NIMBALYST_SYSTEM_MESSAGE>',
      `\n\n${notice}\n</NIMBALYST_SYSTEM_MESSAGE>`
    );
  }

  return `${message}\n\n<NIMBALYST_SYSTEM_MESSAGE>\n${notice}\n</NIMBALYST_SYSTEM_MESSAGE>`;
}
