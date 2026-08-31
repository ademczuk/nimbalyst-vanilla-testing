// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { ContextUsageDisplay } from '../ContextUsageDisplay';

vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: () => null,
}));
vi.mock('../../../help', () => ({ getHelpContent: () => undefined }));

// inputTokens > 0 makes the breakdown panel eligible (enableTooltip).
const props = {
  provider: 'claude-code',
  inputTokens: 80_000,
  outputTokens: 20_000,
  totalTokens: 100_000,
  contextWindow: 200_000,
  currentContext: { tokens: 132_000, contextWindow: 200_000 },
};

afterEach(() => cleanup());

describe('ContextUsageDisplay - context meter opens on click, not hover (#429)', () => {
  it('does NOT open the breakdown panel on hover', () => {
    render(<ContextUsageDisplay {...props} />);
    fireEvent.mouseEnter(screen.getByTestId('context-indicator'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('toggles the panel open and closed on click', () => {
    render(<ContextUsageDisplay {...props} />);
    const meter = screen.getByTestId('context-indicator');
    fireEvent.click(meter);
    screen.getByRole('tooltip');
    fireEvent.click(meter);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes the panel on an outside click', () => {
    render(<ContextUsageDisplay {...props} />);
    fireEvent.click(screen.getByTestId('context-indicator'));
    screen.getByRole('tooltip');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes the panel on Escape', () => {
    render(<ContextUsageDisplay {...props} />);
    fireEvent.click(screen.getByTestId('context-indicator'));
    screen.getByRole('tooltip');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('exposes the meter as a button with aria-expanded when a breakdown exists', () => {
    render(<ContextUsageDisplay {...props} />);
    const meter = screen.getByTestId('context-indicator');
    expect(meter.getAttribute('role')).toBe('button');
    expect(meter.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(meter);
    expect(meter.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('ContextUsageDisplay - cumulative rows are labeled as session totals (#824)', () => {
  it('labels the io breakdown as cumulative session totals when the header shows window fill', () => {
    // Header-right shows current window fill (132k / 200k) while the io rows
    // show cumulative session usage (100k). Without a label the two read as
    // the same quantity and contradict each other (#824: 76k vs 12,073).
    render(<ContextUsageDisplay {...props} />);
    fireEvent.click(screen.getByTestId('context-indicator'));
    screen.getByText('Session totals (cumulative)');
  });

  it('omits the session-totals label when there is no context window (header already says Token Usage)', () => {
    // contextWindow: 0 is the no-window state (hasContextWindow derives from
    // displayContextWindow > 0); the header then reads "Token Usage" and no
    // window-fill total renders, so there is no second quantity to label.
    render(
      <ContextUsageDisplay
        provider="openai"
        inputTokens={80_000}
        outputTokens={20_000}
        totalTokens={100_000}
        contextWindow={0}
      />
    );
    fireEvent.click(screen.getByTestId('context-indicator'));
    expect(screen.queryByText('Session totals (cumulative)')).toBeNull();
  });
});

describe('ContextUsageDisplay - measured provider support (#914)', () => {
  it('does not render an indicator for a provider that reports no usage', () => {
    render(
      <ContextUsageDisplay
        provider="copilot-cli"
        inputTokens={0}
        outputTokens={0}
        totalTokens={0}
        contextWindow={200_000}
        currentContext={{ tokens: 0, contextWindow: 200_000 }}
      />
    );

    expect(screen.queryByTestId('context-indicator')).toBeNull();
  });

  it('shows cumulative counts without inventing a percentage for count-only providers', () => {
    // contextWindow is deliberately non-zero: a catalog window must not turn
    // cumulative spend into a fill, whatever else is passed in.
    render(
      <ContextUsageDisplay
        provider="grok-build"
        inputTokens={80_000}
        outputTokens={20_000}
        totalTokens={100_000}
        contextWindow={200_000}
      />
    );

    // #914: never a fill percentage without a real denominator.
    expect(screen.getByTestId('context-indicator').textContent).not.toMatch(/%|\//);
  });
});
