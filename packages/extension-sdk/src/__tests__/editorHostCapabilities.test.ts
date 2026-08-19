// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  editorHostCapabilityGap,
  editorHostSupports,
} from '../editorHostCapabilities.js';
import type { EditorHostCapabilities } from '../types/editor.js';

const browserCapabilities: EditorHostCapabilities = {
  environment: 'browser',
  unavailable: [{ capability: 'localFileSave', reason: 'No file to write.' }],
  supports: (capability) => capability !== 'localFileSave',
};

describe('editorHostSupports', () => {
  it('treats a host that makes no claim as fully capable', () => {
    // The Electron renderer predates this contract and implements every
    // member. Answering false there would make every portable extension
    // silently drop features on desktop.
    expect(editorHostSupports({}, 'localFileSave')).toBe(true);
    expect(editorHostCapabilityGap({}, 'localFileSave')).toBeNull();
  });

  it('defers to a host that does declare capabilities', () => {
    const host = { capabilities: browserCapabilities };
    expect(editorHostSupports(host, 'collaboration')).toBe(true);
    expect(editorHostSupports(host, 'localFileSave')).toBe(false);
    expect(editorHostCapabilityGap(host, 'localFileSave')).toBe('No file to write.');
    expect(editorHostCapabilityGap(host, 'collaboration')).toBeNull();
  });
});
