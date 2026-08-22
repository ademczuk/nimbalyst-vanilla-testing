/**
 * Subset of opencode.json used by the Electron configuration service. Model
 * discovery itself comes from provider.list in OpenCodeModelCatalog.
 */
export interface OpenCodeFileProviderModel {
  name?: string;
}

export interface OpenCodeFileProvider {
  name?: string;
  npm?: string;
  options?: Record<string, unknown>;
  models?: Record<string, OpenCodeFileProviderModel>;
}

export interface OpenCodeFileConfig {
  $schema?: string;
  model?: string;
  autoupdate?: boolean;
  share?: 'manual' | 'auto' | 'disabled';
  provider?: Record<string, OpenCodeFileProvider>;
  [key: string]: unknown;
}
