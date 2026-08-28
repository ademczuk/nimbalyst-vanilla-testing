/**
 * Host-side tool execution for the built-in Gemini provider.
 *
 * `GeminiAntigravityProvider` lives in the runtime package, which cannot import
 * from Electron main, so it takes an executor by injection. This is that
 * executor. It is the same routing the extension's backend used to do over the
 * broker, minus the broker: a name in `DEV_AGENT_TOOL_NAMES` is a workspace-file
 * operation, anything else is meta-agent orchestration.
 *
 * The permission story changes shape but not substance. As an extension, the
 * two channels were gated on different declared permissions (`workspace-files`
 * vs `nimbalyst-database-write`) because the code was third-party-shaped and
 * had to earn its access. Built in, there is no grant to check — the same
 * process already owns the database and the filesystem. What survives, because
 * it was doing the real work all along, is the *routing*: `workspaceRoot` is
 * the host's own resolved path and never one the model supplied, so a
 * hallucinated path cannot move the jail. `resolveWritePath` and
 * `assertInsideWorkspace` in `devAgentTools.ts` enforce containment within a
 * call.
 *
 * `run_command` is absent on purpose: the provider runs it itself, since it
 * needs nothing from the host but a working directory.
 */

import {
  DEV_AGENT_TOOL_NAMES,
  dispatchDevAgentTool,
  type DevAgentFileWrite,
} from '../../mcp/devAgentTools';
import { dispatchMetaAgentTool } from '../../mcp/metaAgentServer';
import type {
  GeminiToolExecutionResult,
  GeminiToolExecutorArgs,
} from '@nimbalyst/runtime/ai/server/providers/GeminiAntigravityProvider';

export async function executeGeminiTool(
  args: GeminiToolExecutorArgs,
): Promise<GeminiToolExecutionResult> {
  const { name, sessionId, workspacePath } = args;

  if (!workspacePath) {
    return {
      text: `Error: "${name}" needs an open workspace; none is bound to this session.`,
    };
  }

  if (DEV_AGENT_TOOL_NAMES.has(name)) {
    let fileWrite: DevAgentFileWrite | undefined;
    const text = await dispatchDevAgentTool(name, workspacePath, args.args, (change) => {
      fileWrite = change;
    });
    // Only a successful write reports one, so its absence is the signal that
    // there is nothing to snapshot -- an errored write must not produce a
    // phantom entry in the Files Edited sidebar.
    return fileWrite ? { text, fileWrite } : { text };
  }

  const text = await dispatchMetaAgentTool(name, sessionId, workspacePath, args.args);
  return { text };
}
