// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DialogProvider } from '../../contexts/DialogContext';
import { registerConfirmDialog } from '../confirmDialogRegistration';
import { requestConfirmation } from '../requestConfirmation';

registerConfirmDialog();

/**
 * Returns the pending answer wrapped in an object: awaiting a bare
 * `Promise<boolean>` here would block until the user answered.
 */
async function openConfirmation() {
  render(
    <DialogProvider>
      <div />
    </DialogProvider>,
  );
  const answer = requestConfirmation({
    title: 'Remove member',
    message: 'Remove ada@test.com from this organization?',
    confirmLabel: 'Remove',
    destructive: true,
  });
  await screen.findByText('Remove member');
  return { answer };
}

describe('requestConfirmation', () => {
  afterEach(cleanup);

  it('resolves true and dismisses the dialog when confirmed', async () => {
    const { answer } = await openConfirmation();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await expect(answer).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByText('Remove member')).toBeNull());
  });

  it('resolves false and dismisses the dialog when cancelled', async () => {
    const { answer } = await openConfirmation();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(answer).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByText('Remove member')).toBeNull());
  });
});
