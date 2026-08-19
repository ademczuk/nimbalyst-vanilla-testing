// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  logger: { ui: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { customEditorRegistry } from '../registry';

const component = (() => null) as unknown as React.FC<any>;

function register(name: string, extensions: string[]) {
  customEditorRegistry.register({ extensions, component, name } as any);
}

afterEach(() => {
  customEditorRegistry.unregister(['.html', '.mockup.html', '.md', '.calc.md']);
});

describe('customEditorRegistry suffix priority', () => {
  it('routes a compound suffix to its owner even when another editor claims the generic suffix', () => {
    // The Browser extension claims *.html; without longest-key-wins it would
    // swallow every *.mockup.html file and open the wrong editor.
    register('Browser', ['.html']);
    register('MockupLM', ['.mockup.html']);

    expect(customEditorRegistry.findMatchForFile('/w/screen.mockup.html')).toMatchObject({
      key: '.mockup.html',
      registration: { name: 'MockupLM' },
    });
    expect(customEditorRegistry.findMatchForFile('/w/page.html')).toMatchObject({
      key: '.html',
      registration: { name: 'Browser' },
    });
  });

  it('is independent of registration order', () => {
    register('MockupLM', ['.mockup.html']);
    register('Browser', ['.html']);

    expect(customEditorRegistry.findMatchForFile('/w/screen.mockup.html')).toMatchObject({
      registration: { name: 'MockupLM' },
    });
  });
});
