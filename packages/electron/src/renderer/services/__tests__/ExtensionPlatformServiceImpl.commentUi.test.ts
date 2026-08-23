// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExtensionPlatformServiceImpl } from '../ExtensionPlatformServiceImpl';

const COMMENT_UI_SPECIFIER = '@nimbalyst/runtime/editor/commenting/ui';

class CapturingBlob {
  readonly source: string;

  constructor(parts: BlobPart[]) {
    this.source = parts.map((part) => String(part)).join('');
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).__nimbalyst_extensions;
});

describe('ExtensionPlatformServiceImpl comment UI external', () => {
  it('registers and links every comment UI export through the host import map', async () => {
    const moduleSources = new Map<string, string>();
    let nextModuleId = 0;
    let importMap: Record<string, string> | undefined;
    const importShim = Object.assign(
      vi.fn(async () => ({})),
      {
        addImportMap: vi.fn((map: { imports: Record<string, string> }) => {
          importMap = map.imports;
        }),
      }
    );

    vi.stubGlobal('Blob', CapturingBlob);
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      const url = `blob:test-${nextModuleId++}`;
      moduleSources.set(url, (blob as unknown as CapturingBlob).source);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal('importShim', importShim);
    Object.assign(window, {
      electronAPI: {
        invoke: vi.fn(async () => 'export const activate = () => {};'),
      },
    });

    await ExtensionPlatformServiceImpl.getInstance().loadModule(
      '/extension.js'
    );

    const registry = (window as any).__nimbalyst_extensions?.[
      COMMENT_UI_SPECIFIER
    ];
    const wrapperUrl = importMap?.[COMMENT_UI_SPECIFIER];
    expect(registry).toBeDefined();
    expect(wrapperUrl).toBeDefined();

    const wrapperSource = moduleSources.get(wrapperUrl!);
    expect(wrapperSource).toBeDefined();
    const exportNames = Object.keys(registry);
    expect(exportNames).toEqual(
      expect.arrayContaining([
        'CollaborativeCommentsPanel',
        'CommentThreadCard',
        'CommentComposer',
        'CommentMentionPicker',
        'CommentCountBadge',
        'useCollaborativeComments',
        'authorColor',
      ])
    );
    const wrapperDataUrl = `data:text/javascript,${encodeURIComponent(
      wrapperSource!
    )}`;
    const consumerSource = `
      import { ${exportNames.join(', ')} } from ${JSON.stringify(
      wrapperDataUrl
    )};
      export default { ${exportNames.join(', ')} };
    `;
    const consumer = await import(
      /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(
        consumerSource
      )}`
    );

    expect(Object.keys(consumer.default).sort()).toEqual(exportNames.sort());
    for (const exportName of exportNames) {
      expect(consumer.default[exportName]).toBe(registry[exportName]);
    }
  });
});
