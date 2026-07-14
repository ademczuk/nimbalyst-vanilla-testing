// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SharedDocsHome } from '../SharedDocsHome';

// MaterialSymbol pulls in font/asset side-effects we don't need for a layout test.
vi.mock('@nimbalyst/runtime', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SharedDocsHome', () => {
  it('applies the theme background so the empty state is not transparent', () => {
    // Regression: the full-bleed empty state rendered without a background,
    // showing the bare window color (looked wrong under Solarized Light).
    const { container } = render(<SharedDocsHome onDocumentSelect={() => {}} />);
    const root = container.querySelector('.shared-docs-home');
    expect(root).toBeTruthy();
    expect(root?.classList.contains('bg-nim')).toBe(true);
  });
});
