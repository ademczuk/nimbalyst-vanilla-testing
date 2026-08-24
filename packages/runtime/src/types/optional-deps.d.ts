// Type declarations for optional dependencies that are dynamically loaded

// NOTE: `@anthropic-ai/claude-agent-sdk` deliberately has NO block here. It used
// to declare `Options`, `Query`, `SDKMessage` etc. as `any`, and because an
// ambient `declare module` replaces a package's real types wholesale, every
// option we handed the SDK went unchecked -- `settingSources` was typed
// `string[]` against the SDK's own union and nothing could catch it. #1361
// bumped the SDK 20 versions and compatibility could only be established by
// diffing the .d.ts by hand. The package is a hard dependency, so its shipped
// types resolve; do not reintroduce an ambient shim for it.

declare module '@modelcontextprotocol/sdk/server/index.js' {
  export class Server {
    constructor(info: any, options?: any);
    setRequestHandler(schema: any, handler: any): void;
    connect(transport: any): Promise<void>;
    close(): Promise<void>;
    sendToolListChanged(): Promise<void>;
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export class StdioServerTransport {
    constructor();
  }
}

declare module '@modelcontextprotocol/sdk/types.js' {
  export const CallToolRequestSchema: any;
  export const ListToolsRequestSchema: any;
  export const ErrorCode: {
    InternalError: number;
    InvalidRequest: number;
    MethodNotFound: number;
    InvalidParams: number;
    [key: string]: number;
  };
  export class McpError extends Error {
    constructor(code: number, message: string);
  }
  export type Tool = any;
}

declare module 'gifuct-js' {
  export function parseGIF(data: ArrayBuffer): any;
  export function decompressFrames(gif: any, buildImagePatches?: boolean): any[];
}

declare module '@openai/codex-sdk' {
  export class Codex {
    constructor(options?: Record<string, unknown>);
    startThread(options?: Record<string, unknown>): any;
    resumeThread(threadId: string): any;
  }
}
