/**
 * The agent's working-set declaration on a Project Canvas.
 *
 * Two tools, deliberately: declare what you are editing, and release it. There
 * is no canvas-manipulation surface here and this is not the place to grow one
 * -- an agent that can move cards is a separate design conversation, and a wide
 * tool surface added by accident is very hard to take back.
 *
 * The claim is **advisory**. It renders a halo and a chip so a busy board is
 * legible; it grants the session nothing and it prevents nobody from editing
 * the same card at the same moment. Nothing downstream may read it as a lock.
 *
 * Identity is resolved here from the authenticated MCP connection's session id,
 * exactly as the collaborative-comment tools do -- the agent never names itself
 * -- while "on behalf of which human" is answered by the renderer that carries
 * the claim, because that client's awareness entry is the only place that
 * answer can be verified.
 *
 * Release also happens without being asked, twice over: the renderer drops a
 * session's claims when the session reaches a terminal state, and awareness
 * drops the whole entry (and every claim it carried) when the client goes away.
 * A session that crashes mid-edit cannot leave a card haloed.
 */
import { BrowserWindow } from "electron";

import {
  findWindowForFilePath,
  findWindowIdForWorkspacePath,
} from "../mcpWorkspaceResolver";
import { requestFromRenderer } from "../rendererRequest";
import { resolveAgentIdentity } from "./editorToolHandlers";

type McpToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
};

const CANVAS_WORKING_SET_CHANNEL = "mcp:canvasWorkingSet";

export const CANVAS_WORKING_SET_TOOL_SCHEMAS = [
  {
    name: "declareCanvasWorkingSet",
    description:
      "Declare which cards on a Project Canvas (.canvas board) this session is currently editing. Collaborators see a halo and a 'Session X is editing' chip on those cards, and the session appears in the board's presence roster. This is an attention signal, not a lock: it never prevents anyone from editing the same card. Declaring replaces any previous declaration by this session. Call releaseCanvasWorkingSet when finished; the claim is also released automatically when the session ends or its window closes.",
    inputSchema: {
      type: "object",
      properties: {
        board: {
          type: "string",
          description:
            "The board to claim on: an absolute path to a .canvas file, or the collab:// URI of a shared board.",
        },
        nodeIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Canvas node ids currently being edited. An empty array releases the claim.",
        },
      },
      required: ["board", "nodeIds"],
    },
  },
  {
    name: "releaseCanvasWorkingSet",
    description:
      "Release this session's working-set claim on a Project Canvas, removing the halo and the editing chip. Omit nodeIds to release the whole claim on that board.",
    inputSchema: {
      type: "object",
      properties: {
        board: {
          type: "string",
          description:
            "The board to release: an absolute path to a .canvas file, or a collab:// URI.",
        },
        nodeIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Specific node ids to release. Omit to release every card this session holds on the board.",
        },
      },
      required: ["board"],
    },
  },
] as const;

function toolError(code: string, message: string): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }],
    isError: true,
  };
}

async function resolveTargetWindow(
  board: string,
  workspacePath: string | undefined,
): Promise<BrowserWindow | null> {
  try {
    const byFile = await findWindowForFilePath(board);
    if (byFile) return byFile;
  } catch {
    // A board that is not open has no document-state entry. The claim is still
    // valid -- it is held by the workspace window and published when the board
    // opens -- so fall through rather than failing the call.
  }
  if (!workspacePath) return null;
  const windowId = await findWindowIdForWorkspacePath(workspacePath);
  return windowId === null ? null : BrowserWindow.fromId(windowId);
}

async function dispatch(
  mode: "declare" | "release",
  args: any,
  sessionId: string | undefined,
  workspacePath: string | undefined,
): Promise<McpToolResult> {
  const board = typeof args?.board === "string" ? args.board.trim() : "";
  if (board.length === 0) {
    return toolError("INVALID_BOARD", "A board path or collab:// URI is required.");
  }
  const nodeIds = Array.isArray(args?.nodeIds)
    ? args.nodeIds.filter(
        (id: unknown): id is string => typeof id === "string" && id.length > 0,
      )
    : undefined;
  if (mode === "declare" && nodeIds === undefined) {
    return toolError("INVALID_NODE_IDS", "nodeIds must be an array of canvas node ids.");
  }

  let agent: { sessionId: string; sessionName: string };
  try {
    agent = await resolveAgentIdentity(sessionId, workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const separator = message.indexOf(":");
    return toolError(
      separator > 0 ? message.slice(0, separator) : "SESSION_REQUIRED",
      separator > 0 ? message.slice(separator + 1).trim() : message,
    );
  }

  const targetWindow = await resolveTargetWindow(board, workspacePath);
  if (!targetWindow) {
    return toolError(
      "WORKSPACE_NOT_OPEN",
      `No open window hosts ${board}. Open the workspace and retry.`,
    );
  }

  const outcome = await requestFromRenderer<{
    success: boolean;
    published?: boolean;
    nodeIds?: string[];
    code?: string;
    error?: string;
  }>(
    targetWindow,
    CANVAS_WORKING_SET_CHANNEL,
    { mode, board, nodeIds, agent },
    { timeoutMs: 10000 },
  );
  if (outcome.status === "timedOut") {
    return toolError(
      "SYNC_TIMEOUT",
      "Timed out while publishing the canvas working set.",
    );
  }

  const result = outcome.response;
  if (!result?.success) {
    return toolError(
      result?.code || "CANVAS_WORKING_SET_FAILED",
      result?.error || "Unknown canvas working-set error.",
    );
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            board,
            sessionId: agent.sessionId,
            sessionName: agent.sessionName,
            nodeIds: result.nodeIds ?? [],
            // False means the board is not open in this window, so the claim is
            // held and will publish when it opens. Worth reporting rather than
            // hiding: it is the difference between "collaborators can see this"
            // and "they will when someone opens the board".
            published: result.published === true,
          },
          null,
          2,
        ),
      },
    ],
    isError: false,
  };
}

export function handleDeclareCanvasWorkingSet(
  args: any,
  sessionId?: string,
  workspacePath?: string,
): Promise<McpToolResult> {
  return dispatch("declare", args, sessionId, workspacePath);
}

export function handleReleaseCanvasWorkingSet(
  args: any,
  sessionId?: string,
  workspacePath?: string,
): Promise<McpToolResult> {
  return dispatch("release", args, sessionId, workspacePath);
}
