// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildGroundingNote, BRAINSTORM_CHOREOGRAPHY } from '../groundingNote';

describe('buildGroundingNote', () => {
  it('always includes the brainstorm choreography note', () => {
    const note = buildGroundingNote({});
    expect(note).toContain(BRAINSTORM_CHOREOGRAPHY);
  });

  it('reports a ready index with its chunk count', () => {
    const note = buildGroundingNote({
      status: {
        ready: true,
        chunks: 13759,
        denseChunks: 13759,
        indexing: false,
        retrieval: {
          mode: 'hybrid',
          semantic: { available: true },
          keyword: { available: true, source: 'local-project-index' },
        },
      },
    });
    expect(note).toMatch(/13759 chunk/);
    expect(note).toMatch(/ready/i);
  });

  it('signals when the index is still building', () => {
    const note = buildGroundingNote({
      status: { ready: true, chunks: 120, indexing: true },
    });
    expect(note).toMatch(/still building|indexing/i);
    expect(note).toContain('120');
  });

  it('reports keyword-only when a configured provider is failing at runtime', () => {
    // The backend strips lastEmbedError before status reaches here, so the only
    // signal is retrieval: a dims-carrying embedder that is nonetheless keyword-only.
    const note = buildGroundingNote({
      status: {
        ready: true,
        chunks: 100,
        indexing: false,
        embedder: { model: 'text-embedding-3-small' },
        retrieval: {
          mode: 'keyword-only',
          semantic: { available: false },
          keyword: { available: true, source: 'local-project-index' },
        },
      },
    });
    expect(note).toMatch(/keyword/i);
    expect(note).not.toMatch(/api key|credential/i);
  });

  it('explains keyword-only fallback without credential or settings solicitation', () => {
    const note = buildGroundingNote({
      status: {
        ready: true,
        chunks: 42,
        indexing: false,
        retrieval: {
          mode: 'keyword-only',
          semantic: {
            available: false,
            reason: 'optional-embedding-provider-unavailable',
          },
          keyword: { available: true, source: 'local-project-index' },
        },
      },
    });
    expect(note).toMatch(/local keyword.*ready/i);
    expect(note).toMatch(/workspace file\/text search/i);
    expect(note).not.toMatch(/api key|credential|configure.*settings/i);
  });

  it('does not append a raw backend error when the local index is unavailable', () => {
    const note = buildGroundingNote({
      status: {
        ready: false,
        error: 'OpenAI API key not configured. Add one in settings.',
      },
    });
    expect(note).toMatch(/workspace.*markdown|file\/text search/i);
    expect(note).not.toMatch(/api key|credential|configure.*settings/i);
  });

  it('lists durable facts when present, capped to 8', () => {
    const facts = Array.from({ length: 10 }, (_, i) => ({ text: `fact number ${i}` }));
    const note = buildGroundingNote({
      status: { ready: true, chunks: 10, indexing: false },
      facts,
    });
    expect(note).toContain('fact number 0');
    expect(note).toContain('fact number 7');
    expect(note).not.toContain('fact number 8');
  });

  it('omits the facts section when there are no facts', () => {
    const note = buildGroundingNote({
      status: { ready: true, chunks: 10, indexing: false },
      facts: [],
    });
    expect(note).not.toMatch(/durable facts to keep in mind/i);
  });

  it('falls back to just the choreography when status is unavailable', () => {
    const note = buildGroundingNote({ status: null });
    expect(note).toContain(BRAINSTORM_CHOREOGRAPHY);
    expect(note).not.toMatch(/index ready/i);
  });
});
