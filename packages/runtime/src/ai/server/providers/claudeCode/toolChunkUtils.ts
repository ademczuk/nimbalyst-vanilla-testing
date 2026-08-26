import { isBackgroundedToolAck, isInteractiveWidgetTool } from '../../interactivePromptTools';
import { isTransientClaudeCodeFrame } from '../../../../storage/nonRenderingFrames';
import { isImageBlock } from '../../../../utils/contentBytes';

// Claude Agent SDK emits several chunk types that are pure runtime side-channels:
// the live in-memory dispatch loop reacts to them (status text, auth detection,
// rate-limit metadata, tool progress), but the persistent reparse path
// (ClaudeCodeRawParser used by TranscriptTransformer) ignores them entirely.
// Persisting them just inflates ai_agent_messages and SessionRoom storage with
// rows that never produce a canonical transcript event.
//
// The classification itself lives in `storage/nonRenderingFrames` because the
// sync wire gate and the storage backfill need the same answer, and when each
// kept its own copy they drifted -- see that module's header for what the drift
// cost.
//
// Kept persisted on purpose (so deliberately NOT in that set):
//   - system/init           -- carries session_id + tool/MCP context useful for forensics
//   - system/compact_boundary -- marks where the SDK compacted the conversation
//   - summary               -- carries auth-error text the parser may surface later
export function isTransientClaudeCodeChunk(chunk: unknown): boolean {
  return isTransientClaudeCodeFrame(chunk);
}

// Fields on a chunk that are pure dead weight in the persisted raw log:
//   - tool_use_result.{originalFile, oldString, newString, structuredPatch, ...}
//     The Claude Agent SDK attaches a `tool_use_result` sidecar to Edit/Write/Read
//     tool-result messages. It re-stores the edit (already present on the tool_use
//     CALL, which is what the UI renders) PLUS the entire pre-edit file. Nothing in
//     the transcript pipeline, UI, or resume path reads it (resume uses the SDK's
//     own history.jsonl). On a real workload it is ~60% of the claude-code raw log.
//   - assistant thinking block `signature`: a ~12 KB base64 blob used only for
//     Anthropic API continuation; the SDK keeps its own copy, ours is never resent.
//
// We keep small scalar tool_use_result fields (filePath, userModified, replaceAll)
// for forensics and leave the message structure parseable.
const STORAGE_KEEP_SCALAR_MAX_CHARS = 512;

/**
 * Return a storage-slimmed clone of a raw Claude Code SDK chunk: drops the heavy
 * tool_use_result fields and thinking-block signatures. Does NOT mutate the input
 * (the live dispatch loop keeps using the original chunk, incl. its uuid). Returns
 * the input unchanged when there is nothing to trim.
 */
export function slimClaudeCodeChunkForStorage(chunk: unknown): unknown {
  if (!chunk || typeof chunk !== 'object') return chunk;
  const c = chunk as Record<string, unknown>;
  let clone: Record<string, unknown> | null = null;
  const ensureClone = (): Record<string, unknown> => (clone ??= { ...c });

  // 1) Slim the tool_use_result sidecar: keep only small scalars.
  //
  // An ARRAY sidecar is the MCP tool-result content array, and it used to skip
  // this pass entirely because the guard here was `!Array.isArray(tur)`. Almost
  // all of those blocks are `{type:"text"}` and stay -- but an IMAGE block in
  // that array is a byte-for-byte second copy of the screenshot already in
  // `message.content`. Measured on the install this was found on: 468 rows at
  // 263 MB, where sidecar and message.content differed only by the 82-byte
  // tool_use_id wrapper. The row was exactly twice the picture.
  //
  // Only image blocks are dropped. Text blocks are left alone here and bounded
  // downstream by `capClaudeCodeChunkForStorage`.
  const tur = c.tool_use_result;
  if (Array.isArray(tur)) {
    const withoutImages = tur.filter((b) => !isImageBlock(b));
    if (withoutImages.length !== tur.length) {
      ensureClone().tool_use_result = withoutImages;
    }
  } else if (tur && typeof tur === 'object') {
    const turObj = tur as Record<string, unknown>;
    let trimmed = false;
    const slim: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(turObj)) {
      const isSmallScalar =
        v == null ||
        typeof v === 'boolean' ||
        typeof v === 'number' ||
        (typeof v === 'string' && v.length <= STORAGE_KEEP_SCALAR_MAX_CHARS);
      if (isSmallScalar) {
        slim[k] = v;
      } else {
        trimmed = true;
      }
    }
    if (trimmed) {
      ensureClone().tool_use_result = slim;
    }
  }

  // 2) Strip signatures from assistant thinking blocks.
  const message = c.message as { content?: unknown } | undefined;
  if (message && typeof message === 'object' && Array.isArray(message.content)) {
    const blocks = message.content as Array<Record<string, unknown>>;
    const hasSignature = blocks.some(
      (b) => b && b.type === 'thinking' && typeof b.signature === 'string' && (b.signature as string).length > 0,
    );
    if (hasSignature) {
      const slimBlocks = blocks.map((b) => {
        if (b && b.type === 'thinking' && typeof b.signature === 'string') {
          const { signature, ...rest } = b;
          return rest;
        }
        return b;
      });
      const cloned = ensureClone();
      cloned.message = { ...(message as object), content: slimBlocks };
    }
  }

  return clone ?? chunk;
}

export function isSearchableAssistantChunk(chunk: any): boolean {
  if (typeof chunk !== 'object' || chunk.type !== 'assistant' || !chunk.message?.content) {
    return false;
  }

  const content = chunk.message.content;
  if (!Array.isArray(content)) {
    return false;
  }

  const hasText = content.some((block: any) => block.type === 'text');
  const hasTool = content.some((block: any) => block.type === 'tool_use' || block.type === 'tool_result');
  return hasText && !hasTool;
}

export function buildToolUseMessage(toolId: string, toolName: string, toolArgs: unknown): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [{
        type: 'tool_use',
        id: toolId,
        name: toolName,
        input: toolArgs,
      }],
    },
  });
}

export function buildToolResultMessage(
  toolUseId: string,
  content: unknown,
  isError: boolean
): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content,
        is_error: isError,
      }],
    },
  });
}

/**
 * Mutates toolCall in place to keep existing call-site behavior.
 */
export function applyToolResultToToolCall(
  toolCall: any,
  toolResult: unknown,
  isError: boolean
): { isDuplicate: boolean; isBackgroundAck?: boolean } {
  if (toolCall.result !== undefined) {
    return { isDuplicate: true };
  }

  // #1341: an interactive prompt the harness moved to the background is still
  // waiting on the user -- the acknowledgement in the result slot is not an
  // answer. Applying it flips the widget to "answered" with no answers and
  // takes the buttons away. Leave the call outstanding so it stays answerable
  // and the real result can land later.
  if (isInteractiveWidgetTool(toolCall.name) && isBackgroundedToolAck(toolResult)) {
    return { isDuplicate: false, isBackgroundAck: true };
  }

  toolCall.result = toolResult;

  const hasErrorFlag = isError === true;
  const hasErrorContent = typeof toolResult === 'string'
    && (toolResult.includes('<tool_use_error>') || toolResult.startsWith('Error:'));
  if (hasErrorFlag || hasErrorContent) {
    toolCall.isError = true;
  }

  // Preserve Edit diffs for UI red/green rendering.
  if (toolCall.name === 'Edit' && toolCall.arguments && !toolCall.isError) {
    const args = toolCall.arguments as any;
    if (args.old_string !== undefined || args.new_string !== undefined) {
      const resultMessage = typeof toolResult === 'string'
        ? toolResult
        : JSON.stringify(toolResult);
      toolCall.result = {
        message: resultMessage,
        file_path: args.file_path,
        old_string: args.old_string,
        new_string: args.new_string,
      };
    }
  }

  return { isDuplicate: false };
}
