import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptViewMessage } from '../../../../ai/server/transcript/TranscriptProjector';
import { RichTranscriptView } from '../RichTranscriptView';

vi.mock('virtua', async () => {
  const ReactModule = await import('react');
  return {
    VList: ReactModule.forwardRef(({ children }: { children: React.ReactNode }, ref) => {
      ReactModule.useImperativeHandle(ref, () => ({
        cache: undefined,
        scrollOffset: 0,
        scrollSize: 300,
        viewportSize: 100,
        findItemIndex: () => 0,
        scrollToIndex: vi.fn(),
      }));
      return <div data-testid="mock-vlist">{ReactModule.Children.toArray(children)}</div>;
    }),
  };
});

function makeFileChangeMessage(changes: unknown[]): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date(1_784_648_445_000),
    type: 'tool_call',
    subagentId: null,
    toolCall: {
      toolName: 'file_change',
      toolDisplayName: 'apply_patch',
      status: 'completed',
      description: null,
      arguments: { changes },
      targetFilePath: (changes[0] as { path?: string })?.path ?? null,
      mcpServer: null,
      mcpTool: null,
      providerToolCallId: 'nimtc|item_0|1730000000000|42',
      progress: [],
      result: `Applied ${changes.length} file change(s)`,
    },
  };
}

// A Codex edit must land on the red/green EditToolResultCard, not the generic
// tool card that dumps the arguments as JSON. The patch text lives in the tool
// arguments, so this holds without any main-side history-diff enrichment --
// which is what regressed when lazy diff loading landed (#1191).
describe('RichTranscriptView Codex file_change routing', () => {
  beforeEach(() => {
    vi.stubGlobal('CSS', { highlights: { delete: vi.fn(), set: vi.fn() } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('renders an update as a diff card showing both sides of the hunk', () => {
    const { container } = render(
      <RichTranscriptView
        sessionId="codex-1"
        sessionStatus="idle"
        messages={[makeFileChangeMessage([
          {
            path: '/workspace/src/app.ts',
            kind: 'update',
            move_path: null,
            diff: '@@ -1,1 +1,1 @@\n-export const x = 1;\n+export const x = 2;\n',
          },
        ])]}
        provider="openai-codex"
        workspacePath="/workspace"
        persistScrollState={false}
      />,
    );

    expect(container.querySelector('.rich-transcript-edit-card')).not.toBeNull();
    expect(container.querySelector('.rich-transcript-tool-card')).toBeNull();
    expect(screen.getByText('export const x = 1;')).toBeDefined();
    expect(screen.getByText('export const x = 2;')).toBeDefined();
  });

  it('falls back to the generic tool card when the changes carry no diff', () => {
    // The legacy @openai/codex-sdk transport passes the SDK's `changes` through
    // verbatim and they have no patch text -- an empty diff card would be worse
    // than the raw arguments.
    const { container } = render(
      <RichTranscriptView
        sessionId="codex-2"
        sessionStatus="idle"
        messages={[makeFileChangeMessage([{ path: '/workspace/src/app.ts', kind: 'update' }])]}
        provider="openai-codex"
        workspacePath="/workspace"
        persistScrollState={false}
      />,
    );

    expect(container.querySelector('.rich-transcript-edit-card')).toBeNull();
    expect(container.querySelector('.rich-transcript-tool-card')).not.toBeNull();
  });
});
