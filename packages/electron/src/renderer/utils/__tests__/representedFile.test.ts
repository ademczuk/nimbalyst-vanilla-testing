// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { resolveRepresentedFile } from '../representedFile';

describe('resolveRepresentedFile', () => {
    it('represents a real file path', () => {
        expect(resolveRepresentedFile('/ws/notes.md')).toBe('/ws/notes.md');
    });

    // The regression this exists for: no active file must clear, not linger on
    // whatever was represented last.
    it('returns null when no file is active', () => {
        expect(resolveRepresentedFile(null)).toBeNull();
        expect(resolveRepresentedFile(undefined)).toBeNull();
        expect(resolveRepresentedFile('')).toBeNull();
    });

    it.each([
        ['collab', 'collab://org:abc123:doc:xyz789'],
        ['tracker', 'tracker://item-42'],
        ['virtual', 'virtual://scratch'],
    ])('ignores %s URIs, which are not filesystem paths', (_kind, filePath) => {
        expect(resolveRepresentedFile(filePath)).toBeNull();
    });
});
