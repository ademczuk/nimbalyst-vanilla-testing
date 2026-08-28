// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { WalkthroughState } from '../../walkthroughs/types';
import type { TipDefinition } from '../types';
import { shouldShowTip, tipLastShownAt } from '../TipService';
import { TipCard } from '../TipCard';

const baseState: WalkthroughState = {
  enabled: true,
  completed: [],
  dismissed: [],
  history: {},
};

const baseTip: TipDefinition = {
  id: 'tip-test',
  name: 'Test Tip',
  version: 2,
  trigger: {
    condition: () => true,
  },
  content: {
    title: 'Test Tip',
    body: 'Body',
  },
};

describe('shouldShowTip', () => {
  it('does not show completed tips on the same version', () => {
    const state: WalkthroughState = {
      ...baseState,
      completed: ['tip-test'],
      history: {
        'tip-test': {
          shownAt: 1,
          completedAt: 2,
          version: 2,
        },
      },
    };

    expect(shouldShowTip(state, baseTip)).toBe(false);
  });

  it('re-shows a completed tip when the version changes', () => {
    const state: WalkthroughState = {
      ...baseState,
      completed: ['tip-test'],
      dismissed: ['tip-test'],
      history: {
        'tip-test': {
          shownAt: 1,
          completedAt: 2,
          dismissedAt: 3,
          version: 1,
        },
      },
    };

    expect(shouldShowTip(state, baseTip)).toBe(true);
  });
});

describe('tipLastShownAt rotation ordering', () => {
  // The provider sorts by priority and then by this value. Without it the sort
  // is stable on definition order, so the first tip in an equal-priority band
  // wins every launch and its neighbours are unreachable.
  const bandOf = (ids: string[], state: WalkthroughState) =>
    [...ids].sort((a, b) => tipLastShownAt(state, a) - tipLastShownAt(state, b));

  it('puts never-shown tips ahead of ones already seen', () => {
    const state: WalkthroughState = {
      ...baseState,
      history: { 'tip-a': { shownAt: 5_000, version: 1 } },
    };

    expect(tipLastShownAt(state, 'tip-a')).toBe(5_000);
    expect(tipLastShownAt(state, 'tip-never')).toBe(0);
    expect(bandOf(['tip-a', 'tip-never'], state)).toEqual(['tip-never', 'tip-a']);
  });

  it('sends the most recently shown tip to the back of its band', () => {
    const state: WalkthroughState = {
      ...baseState,
      history: {
        'tip-a': { shownAt: 3_000, version: 1 },
        'tip-b': { shownAt: 1_000, version: 1 },
        'tip-c': { shownAt: 2_000, version: 1 },
      },
    };

    expect(bandOf(['tip-a', 'tip-b', 'tip-c'], state)).toEqual([
      'tip-b',
      'tip-c',
      'tip-a',
    ]);
  });
});

describe('TipCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders paragraphs, bullet lists, and bold text in the body', () => {
    const tip: TipDefinition = {
      ...baseTip,
      content: {
        title: 'Formatting Tip',
        body: 'Lead paragraph with **bold** text.\n\n- First item\n- Second **item**',
        action: {
          label: 'Do it',
          onClick: vi.fn(),
        },
      },
    };

    render(
      <TipCard
        tip={tip}
        onDismiss={vi.fn()}
        onAction={vi.fn()}
      />
    );

    screen.getByText('Formatting Tip');

    const list = screen.getByRole('list');

    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['First item', 'Second item']);

    const paragraph = document.querySelector('.tip-card-paragraph');
    expect(paragraph?.textContent).toBe('Lead paragraph with bold text.');
  });
});
