// @vitest-environment jsdom

/**
 * A dialog opened to ask a question has to tell its opener when it goes away
 * without answering -- otherwise the caller waits forever. The two exits that
 * never reach the dialog component's own `onClose` are the ones covered here:
 * ESC, which the provider handles itself, and being displaced by another
 * exclusive dialog.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

import { DialogProvider, dialogRef, registerDialog } from '../DialogContext';

function registerProbe(id: string): void {
  registerDialog<{ onDismiss?: () => void }>({
    id,
    group: 'system',
    component: () => <div data-testid={id} />,
    priority: 100,
  });
}

afterEach(cleanup);

describe('DialogProvider dismissal', () => {
  it('tells the opener when the dialog is closed by ESC or displaced by another', () => {
    registerProbe('probe-a');
    registerProbe('probe-b');
    render(<DialogProvider workspacePath="/workspace"><div /></DialogProvider>);

    const dismissedByEsc = vi.fn();
    act(() => dialogRef.current?.open('probe-a', { onDismiss: dismissedByEsc }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dismissedByEsc).toHaveBeenCalledTimes(1);

    const displaced = vi.fn();
    act(() => dialogRef.current?.open('probe-a', { onDismiss: displaced }));
    act(() => dialogRef.current?.open('probe-b', {}));
    expect(displaced).toHaveBeenCalledTimes(1);
  });
});
