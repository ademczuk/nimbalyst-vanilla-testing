import type { createOpencodeClient } from '@opencode-ai/sdk/client';

export interface OpenCodeSdkClientModule {
  createOpencodeClient: typeof createOpencodeClient;
}

/** Load the ESM-only OpenCode client through the single packaged-app boundary. */
export async function loadOpenCodeSdkClientModule(): Promise<OpenCodeSdkClientModule> {
  try {
    const moduleName = '@opencode-ai/sdk/client';
    return (await import(
      /* webpackIgnore: true */ moduleName
    )) as OpenCodeSdkClientModule;
  } catch (error) {
    throw new Error(
      'Failed to load @opencode-ai/sdk. Install it with: npm install @opencode-ai/sdk\n' +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
