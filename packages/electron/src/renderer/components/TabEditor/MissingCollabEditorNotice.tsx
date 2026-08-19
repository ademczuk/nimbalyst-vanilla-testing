/**
 * Shown in place of the editor when a shared document's type has no usable
 * local editor. Names the extension the document needs and offers to open it
 * in the marketplace, so the recipient has a way forward instead of a bare
 * "No editor available for document type: X".
 */

import React, { useEffect, useState } from 'react';
import { useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { extensionMarketplaceInstallRequestAtom } from '../../store/atoms/appCommands';
import type { CollabEditorAvailability } from './collabEditorAvailability';

interface MissingCollabEditorNoticeProps {
  availability: Exclude<CollabEditorAvailability, { kind: 'ready' }>;
  /** Document type as stored on the shared document (e.g. `slides.md`). */
  documentType: string;
}

interface RegistryEntry {
  id: string;
  name?: string;
}

/**
 * Resolves a human-readable extension name from the marketplace registry.
 * Falls back to the raw id, which is still more actionable than nothing.
 */
function useMarketplaceExtensionName(extensionId: string | undefined): {
  name: string | undefined;
  listed: boolean;
} {
  const [entry, setEntry] = useState<{ name?: string; listed: boolean }>({ listed: false });

  useEffect(() => {
    if (!extensionId) return;
    let cancelled = false;

    void window.electronAPI
      ?.invoke('extension-marketplace:fetch-registry')
      .then((result: { success?: boolean; data?: { extensions?: RegistryEntry[] } }) => {
        if (cancelled || !result?.success) return;
        const match = result.data?.extensions?.find((candidate) => candidate.id === extensionId);
        if (match) setEntry({ name: match.name, listed: true });
      })
      .catch(() => {
        // Offline or registry unreachable: the id-only message still stands.
      });

    return () => {
      cancelled = true;
    };
  }, [extensionId]);

  return { name: entry.name ?? extensionId, listed: entry.listed };
}

export const MissingCollabEditorNotice: React.FC<MissingCollabEditorNoticeProps> = ({
  availability,
  documentType,
}) => {
  const requestMarketplaceInstall = useSetAtom(extensionMarketplaceInstallRequestAtom);
  const { extensionId } = availability;
  const { name, listed } = useMarketplaceExtensionName(extensionId);

  const isMissing = availability.kind === 'extension-missing';
  const headline = !extensionId
    ? `No editor available for document type: ${documentType}`
    : isMissing
      ? `${name} isn't installed`
      : `${name} can't open shared documents`;

  const detail = !extensionId
    ? 'This document was shared from an editor this copy of Nimbalyst does not recognize.'
    : isMissing
      ? 'This shared document needs that extension to open.'
      : 'Update the extension to a version that supports collaborative editing.';

  return (
    <div className="missing-collab-editor-notice flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-nim-muted">
      <MaterialSymbol icon="extension_off" size={32} />
      <div className="text-nim-text">{headline}</div>
      <div className="max-w-md text-sm">{detail}</div>
      {extensionId && (
        <button
          type="button"
          className="missing-collab-editor-install rounded border border-[var(--nim-border)] px-3 py-1.5 text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)]"
          onClick={() => {
            requestMarketplaceInstall({
              version: Date.now(),
              request: { extensionId, requestedAt: new Date().toISOString() },
            });
          }}
        >
          {listed
            ? isMissing
              ? `Install ${name}`
              : `Update ${name}`
            : 'Open Extension Marketplace'}
        </button>
      )}
    </div>
  );
};
