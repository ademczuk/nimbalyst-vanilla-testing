/**
 * Resolves which editor a collaborative document should open in, and -- when
 * none is available -- WHY.
 *
 * A shared document carries its type across clients, but the editor that
 * renders it is local: it comes from an extension the recipient may not have.
 * Collapsing "you don't have the extension" and "your copy is too old to
 * collaborate" into a single dead end leaves the recipient with no way forward:
 * a shared .slides.md was unopenable on a second machine because the Slides
 * extension was installed only on the first, and the tab said nothing beyond
 * the raw document type.
 *
 * Keeping this pure and separate from CollaborativeTabEditor lets the branch
 * logic be tested without mounting the collab editor tree.
 */

import type { CustomEditorRegistration } from '../CustomEditors/types';

export type CollabEditorAvailability =
  /** An extension editor is installed and declares collaboration support. */
  | { kind: 'ready'; registration: CustomEditorRegistration }
  /** Nothing local claims this file type. */
  | { kind: 'extension-missing'; extensionId?: string }
  /**
   * An editor is installed but cannot collaborate: either it never declared
   * `collaboration.supported`, or a different extension claims the file type
   * than the one the document was shared from.
   */
  | { kind: 'extension-cannot-collaborate'; extensionId?: string; installedExtensionId?: string };

export interface CollabEditorAvailabilityInput {
  /** Document type as stored on the shared document (e.g. `slides.md`). */
  documentType: string;
  /** Local tab file name, which may or may not carry the extension. */
  fileName: string;
  /** Share filename extension, when the document recorded one. */
  fileExtension?: string;
  /** Shared document title, used to reconstruct a lookup name. */
  title?: string;
  /** Extension the document was shared from, when recorded. */
  editorId?: string;
  findRegistration: (fileName: string) => CustomEditorRegistration | undefined;
}

/**
 * Builds the name handed to the custom-editor registry. Prefers the share
 * filename extension (e.g. `.slides.md`), so a recipient of a doc shared with
 * a bare title still routes to the right editor.
 */
export function collabEditorLookupName(
  input: Pick<CollabEditorAvailabilityInput, 'fileName' | 'fileExtension' | 'title' | 'documentType'>,
): string {
  if (input.fileExtension) return `document${input.fileExtension}`;
  if (input.fileName.includes('.')) return input.fileName;
  return `${input.title ?? 'document'}.${input.documentType}`;
}

export function resolveCollabEditorAvailability(
  input: CollabEditorAvailabilityInput,
): CollabEditorAvailability {
  const match = input.findRegistration(collabEditorLookupName(input));

  if (!match) {
    return { kind: 'extension-missing', extensionId: input.editorId };
  }

  // A different extension claims the type locally. Rendering it would bind the
  // wrong editor to the room, so treat it as unavailable rather than guess.
  if (input.editorId && match.extensionId !== input.editorId) {
    return {
      kind: 'extension-cannot-collaborate',
      extensionId: input.editorId,
      installedExtensionId: match.extensionId,
    };
  }

  if (!match.collaboration?.supported) {
    return {
      kind: 'extension-cannot-collaborate',
      extensionId: input.editorId ?? match.extensionId,
      installedExtensionId: match.extensionId,
    };
  }

  return { kind: 'ready', registration: match };
}
