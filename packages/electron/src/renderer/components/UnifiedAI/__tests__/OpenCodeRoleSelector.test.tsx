// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

import type { OpenCodeAgentCatalogSnapshot } from '../../../../shared/openCodeAgentCatalog';

vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: () => null,
}));

vi.mock('../../../hooks/useFloatingMenu', () => ({
  FloatingPortal: ({ children }: { children: React.ReactNode }) => children,
  useFloatingMenu: () => ({
    isOpen: false,
    setIsOpen: vi.fn(),
    refs: { setReference: vi.fn(), setFloating: vi.fn() },
    floatingStyles: {},
    getReferenceProps: () => ({}),
    getFloatingProps: () => ({}),
  }),
}));

import { OpenCodeRoleSelector } from '../OpenCodeRoleSelector';

const UNDISCOVERED: OpenCodeAgentCatalogSnapshot = { agents: [], discovered: false };
const ONE_ROLE: OpenCodeAgentCatalogSnapshot = {
  discovered: true,
  agents: [{ name: 'plan', mode: 'primary', builtIn: true, permission: { edit: 'deny', bash: {} } }],
};

describe('OpenCodeRoleSelector', () => {
  afterEach(() => {
    cleanup();
    delete (window as any).electronAPI;
    vi.clearAllMocks();
  });

  it('appears when the first turn discovers roles, with no remount', async () => {
    // Roles only exist once a server is running, and the first turn is what
    // starts one. Fetching only on mount left the control hidden for the whole
    // ordinary path -- open a session, send a prompt -- because nothing it
    // depended on changed when the roles arrived.
    const openCodeAgentCatalogGet = vi
      .fn()
      .mockResolvedValueOnce({ success: true, catalog: UNDISCOVERED })
      .mockResolvedValue({ success: true, catalog: ONE_ROLE });
    (window as any).electronAPI = { openCodeAgentCatalogGet };

    const view = render(
      <OpenCodeRoleSelector
        workspacePath="/tmp/project"
        role={null}
        onRoleChange={vi.fn()}
        turnActive={false}
      />
    );

    await waitFor(() => expect(openCodeAgentCatalogGet).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('opencode-role-selector')).toBeNull();

    view.rerender(
      <OpenCodeRoleSelector
        workspacePath="/tmp/project"
        role={null}
        onRoleChange={vi.fn()}
        turnActive
      />
    );

    await waitFor(() => expect(screen.getByTestId('opencode-role-selector')).toBeTruthy());
  });

  it('keeps a discovered role listed when a later read finds no running server', async () => {
    const openCodeAgentCatalogGet = vi
      .fn()
      .mockResolvedValueOnce({ success: true, catalog: ONE_ROLE })
      .mockResolvedValue({ success: true, catalog: UNDISCOVERED });
    (window as any).electronAPI = { openCodeAgentCatalogGet };

    const view = render(
      <OpenCodeRoleSelector
        workspacePath="/tmp/project"
        role={null}
        onRoleChange={vi.fn()}
        turnActive={false}
      />
    );

    await waitFor(() => expect(screen.getByTestId('opencode-role-selector')).toBeTruthy());

    view.rerender(
      <OpenCodeRoleSelector
        workspacePath="/tmp/project"
        role={null}
        onRoleChange={vi.fn()}
        turnActive
      />
    );

    await waitFor(() => expect(openCodeAgentCatalogGet).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('opencode-role-selector')).toBeTruthy();
  });
});
