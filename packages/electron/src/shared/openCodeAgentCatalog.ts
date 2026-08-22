// Type-only re-exports so renderer code can describe OpenCode session roles
// without pulling the runtime barrel into its module graph.
export type {
  OpenCodeAgentSummary,
  OpenCodeAgentCatalogSnapshot,
} from '@nimbalyst/runtime/ai/server';

export interface OpenCodeAgentCatalogRequest {
  workspacePath: string;
}

export type OpenCodeAgentCatalogIpcResponse =
  | { success: true; catalog: import('@nimbalyst/runtime/ai/server').OpenCodeAgentCatalogSnapshot }
  | { success: false; error: string };
