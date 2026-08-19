/**
 * A recipient without the owning extension must be told which extension the
 * shared document needs -- the regression this guards is silent: the tab still
 * renders, it just dead-ends.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider, useAtomValue } from 'jotai';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  resolveCollabEditorAvailability,
  collabEditorLookupName,
} from '../collabEditorAvailability';
import { MissingCollabEditorNotice } from '../MissingCollabEditorNotice';
import { extensionMarketplaceInstallRequestAtom } from '../../../store/atoms/appCommands';
import type { CustomEditorRegistration } from '../../CustomEditors/types';

vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

const slidesRegistration = (
  overrides: Partial<CustomEditorRegistration> = {},
): CustomEditorRegistration => ({
  extensions: ['.slides.md'],
  component: (() => null) as unknown as CustomEditorRegistration['component'],
  extensionId: 'com.nimbalyst.slides',
  collaboration: { supported: true },
  ...overrides,
});

describe('resolveCollabEditorAvailability', () => {
  it('reports the sharing extension when nothing local claims the type', () => {
    const result = resolveCollabEditorAvailability({
      documentType: 'slides.md',
      fileName: 'demo',
      fileExtension: '.slides.md',
      editorId: 'com.nimbalyst.slides',
      findRegistration: () => undefined,
    });

    expect(result).toEqual({
      kind: 'extension-missing',
      extensionId: 'com.nimbalyst.slides',
    });
  });

  it('treats an installed editor without collaboration support as unusable', () => {
    const result = resolveCollabEditorAvailability({
      documentType: 'slides.md',
      fileName: 'demo.slides.md',
      editorId: 'com.nimbalyst.slides',
      findRegistration: () => slidesRegistration({ collaboration: undefined }),
    });

    expect(result.kind).toBe('extension-cannot-collaborate');
  });

  it('refuses to bind a different extension that claims the same type', () => {
    const result = resolveCollabEditorAvailability({
      documentType: 'slides.md',
      fileName: 'demo.slides.md',
      editorId: 'com.nimbalyst.slides',
      findRegistration: () => slidesRegistration({ extensionId: 'com.someone.else' }),
    });

    expect(result).toMatchObject({
      kind: 'extension-cannot-collaborate',
      extensionId: 'com.nimbalyst.slides',
      installedExtensionId: 'com.someone.else',
    });
  });

  it('resolves to the registration when the extension can collaborate', () => {
    const registration = slidesRegistration();
    const result = resolveCollabEditorAvailability({
      documentType: 'slides.md',
      fileName: 'demo.slides.md',
      editorId: 'com.nimbalyst.slides',
      findRegistration: () => registration,
    });

    expect(result).toEqual({ kind: 'ready', registration });
  });

  it('rebuilds a lookup name for a doc shared under a bare title', () => {
    expect(
      collabEditorLookupName({
        documentType: 'slides.md',
        fileName: 'Quarterly review',
        title: 'Quarterly review',
      }),
    ).toBe('Quarterly review.slides.md');
  });
});

describe('MissingCollabEditorNotice', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      invoke: vi.fn().mockResolvedValue({
        success: true,
        data: { extensions: [{ id: 'com.nimbalyst.slides', name: 'Nimbalyst Slides' }] },
      }),
    };
  });

  const InstallRequestProbe: React.FC = () => {
    const request = useAtomValue(extensionMarketplaceInstallRequestAtom);
    return <div data-testid="install-request">{request?.request.extensionId ?? 'none'}</div>;
  };

  it('names the extension and asks the marketplace to install it', async () => {
    render(
      <Provider>
        <MissingCollabEditorNotice
          availability={{ kind: 'extension-missing', extensionId: 'com.nimbalyst.slides' }}
          documentType="slides.md"
        />
        <InstallRequestProbe />
      </Provider>,
    );

    const button = await screen.findByRole('button', { name: 'Install Nimbalyst Slides' });
    expect(screen.getByText("Nimbalyst Slides isn't installed")).toBeTruthy();

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId('install-request').textContent).toBe('com.nimbalyst.slides');
    });
  });

  it('falls back to the raw document type when no extension is recorded', () => {
    render(
      <Provider>
        <MissingCollabEditorNotice
          availability={{ kind: 'extension-missing' }}
          documentType="widget.json"
        />
      </Provider>,
    );

    expect(screen.getByText('No editor available for document type: widget.json')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
