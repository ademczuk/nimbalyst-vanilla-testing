// @vitest-environment node
//
// #1341: Claude Code parks a slow MCP call at 120s and returns an
// acknowledgement in the tool_result slot. Treating that as the real result
// retires the question widget while the call is still running, so the user
// cannot answer a question that is still waiting on them.

import { describe, it, expect } from 'vitest';

import {
  isBackgroundedToolAck,
  isInteractiveWidgetTool,
} from '../interactivePromptTools';
import { applyToolResultToToolCall } from '../providers/claudeCode/toolChunkUtils';

const MCP_ACK =
  'MCP tool "nimbalyst - AskUserQuestion (MCP)" is still running after 120s. '
  + 'It was moved to the background as task bq7x2k and keeps running; you\'ll receive a '
  + 'notification with the result when it completes.';

const BASH_ACK =
  'Command did not complete within its 120s timeout and was moved to the background (ID: bibikgthp).';

describe('isBackgroundedToolAck', () => {
  it('recognises the MCP and Bash/sub-agent wordings', () => {
    expect(isBackgroundedToolAck(MCP_ACK)).toBe(true);
    expect(isBackgroundedToolAck(BASH_ACK)).toBe(true);
    expect(isBackgroundedToolAck('Async agent launched successfully')).toBe(true);
  });

  it('does not mistake a real prompt answer for an acknowledgement', () => {
    // A settled prompt is always a JSON payload -- including one whose answer
    // text happens to quote the acknowledgement wording.
    expect(isBackgroundedToolAck(JSON.stringify({ answers: { q: 'moved to the background' } }))).toBe(false);
    expect(isBackgroundedToolAck(JSON.stringify({ cancelled: true }))).toBe(false);
    expect(isBackgroundedToolAck('')).toBe(false);
    expect(isBackgroundedToolAck(undefined)).toBe(false);
  });
});

describe('applyToolResultToToolCall', () => {
  it('leaves an interactive prompt pending on a background acknowledgement', () => {
    const toolCall: any = { name: 'mcp__nimbalyst__AskUserQuestion', arguments: { questions: [] } };

    const { isBackgroundAck } = applyToolResultToToolCall(toolCall, MCP_ACK, false);

    expect(isBackgroundAck).toBe(true);
    expect(toolCall.result).toBeUndefined();
  });

  it('still applies the acknowledgement to a non-interactive tool', () => {
    const toolCall: any = { name: 'mcp__nimbalyst-trackers__tracker_list', arguments: {} };

    const { isBackgroundAck } = applyToolResultToToolCall(toolCall, MCP_ACK, false);

    expect(isBackgroundAck).toBeFalsy();
    expect(toolCall.result).toBe(MCP_ACK);
  });

  it('applies the real answer once the prompt settles', () => {
    const toolCall: any = { name: 'mcp__nimbalyst__AskUserQuestion', arguments: {} };
    const answer = JSON.stringify({ answers: { 'Pick one': 'A' } });

    applyToolResultToToolCall(toolCall, MCP_ACK, false);
    const { isDuplicate } = applyToolResultToToolCall(toolCall, answer, false);

    expect(isDuplicate).toBe(false);
    expect(toolCall.result).toBe(answer);
  });
});

describe('isInteractiveWidgetTool', () => {
  it('matches bare and MCP-prefixed prompt tools only', () => {
    expect(isInteractiveWidgetTool('AskUserQuestion')).toBe(true);
    expect(isInteractiveWidgetTool('mcp__nimbalyst__developer_git_commit_proposal')).toBe(true);
    expect(isInteractiveWidgetTool('mcp__nimbalyst-trackers__tracker_list')).toBe(false);
    expect(isInteractiveWidgetTool(undefined)).toBe(false);
  });
});
