import type { OpenCodeModelCatalogSnapshot } from '@nimbalyst/runtime/ai/server';

// Type-only re-exports so renderer code can describe the catalog without
// pulling the runtime barrel into its module graph.
export type {
  AIModel,
  OpenCodeModelCatalogSnapshot,
  OpenCodeModelCatalogCacheStatus,
  OpenCodeModelCatalogStaleReason,
} from '@nimbalyst/runtime/ai/server';

export interface OpenCodeModelCatalogRefreshRequest {
  workspacePath: string;
}

export type OpenCodeModelCatalogIpcResponse =
  | { success: true; catalog: OpenCodeModelCatalogSnapshot }
  | { success: false; error: string };
