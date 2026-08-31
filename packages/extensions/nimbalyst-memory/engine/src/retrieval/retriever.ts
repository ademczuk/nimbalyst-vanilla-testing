/**
 * Hybrid retriever: dense cosine + BM25 sparse, fused with RRF, plus
 * expand-to-section using the chunk heading breadcrumb. Operates over an
 * in-memory snapshot of stored chunks (rebuilt cheaply when the index changes).
 */
import type { SearchHit, StoredChunk } from '../types.js';
import { cosineSimilarity } from './cosine.js';
import { Bm25Index } from './bm25.js';
import { reciprocalRankFusion } from './rrf.js';

const DENSE_CANDIDATES = 50;
const SPARSE_CANDIDATES = 50;

function citation(c: { sourcePath: string; headingPath: string[] }): string {
  const heading = c.headingPath[c.headingPath.length - 1];
  return heading ? `${c.sourcePath}#${heading}` : c.sourcePath;
}

export class Retriever {
  private chunks: StoredChunk[];
  private byId = new Map<string, StoredChunk>();
  private bm25: Bm25Index;

  constructor(chunks: StoredChunk[]) {
    this.chunks = chunks;
    for (const c of chunks) this.byId.set(c.id, c);
    this.bm25 = new Bm25Index(chunks.map((c) => ({ id: c.id, tf: c.sparseTerms })));
  }

  get size(): number {
    return this.chunks.length;
  }

  /**
   * @param queryVector dense query embedding (same embedder as the index), or
   *   null to run sparse-only (e.g. before any embedding is available).
   * @param opts.sourceClasses restrict retrieval to these source classes (e.g.
   *   `['sessions']`). Applied BEFORE the dense/sparse candidate cap so a small
   *   class isn't crowded out of the (capped) global candidate pool by a large
   *   one — the difference between "find a session about X" working or not.
   */
  search(
    queryText: string,
    queryVector: number[] | null,
    k = 5,
    opts?: { sourceClasses?: string[] },
  ): SearchHit[] {
    const allowed =
      opts?.sourceClasses && opts.sourceClasses.length ? new Set(opts.sourceClasses) : null;
    const inScope = (c: StoredChunk): boolean => !allowed || allowed.has(c.sourceClass);

    // Raw per-arm scores are kept alongside the ranks. RRF output is a rank
    // reciprocal, not a similarity: it is not comparable across queries, so a
    // caller that needs a threshold ("close enough to warn about a duplicate")
    // cannot get one from `score`. `similarity` carries the raw numbers.
    const denseScores = new Map<string, number>();
    const denseRanked =
      queryVector && queryVector.length
        ? this.chunks
            .filter((c) => inScope(c) && c.denseEmbedding && c.denseEmbedding.length)
            .map((c) => ({ id: c.id, s: cosineSimilarity(queryVector, c.denseEmbedding!) }))
            .sort((a, b) => b.s - a.s)
            .slice(0, DENSE_CANDIDATES)
            .map((x) => {
              denseScores.set(x.id, x.s);
              return x.id;
            })
        : [];

    const sparseScores = new Map<string, number>();
    const sparseRanked = this.bm25
      .search(queryText)
      .filter((x) => {
        const c = this.byId.get(x.id);
        return c ? inScope(c) : false;
      })
      .slice(0, SPARSE_CANDIDATES)
      .map((x) => {
        sparseScores.set(x.id, x.score);
        return x.id;
      });

    // Membership sets for per-hit signal provenance (semantic vs keyword).
    const denseSet = new Set(denseRanked);
    const sparseSet = new Set(sparseRanked);

    const fused = reciprocalRankFusion([
      { ids: denseRanked, weight: 1 },
      { ids: sparseRanked, weight: 1 },
    ]);

    const hits: SearchHit[] = [];
    for (const { id, score } of fused.slice(0, k)) {
      const c = this.byId.get(id);
      if (!c) continue;
      hits.push({
        sourcePath: c.sourcePath,
        sourceClass: c.sourceClass,
        refType: c.refType,
        refId: c.refId,
        headingPath: c.headingPath,
        text: c.text,
        score,
        citation: citation(c),
        signals: { dense: denseSet.has(id), sparse: sparseSet.has(id) },
        similarity: {
          ...(denseScores.has(id) ? { cosine: denseScores.get(id)! } : {}),
          ...(sparseScores.has(id) ? { bm25: sparseScores.get(id)! } : {}),
        },
      });
    }
    return hits;
  }

  /**
   * Expand a hit to its full heading section: all chunks in the same source
   * whose heading breadcrumb is the matched path (or a descendant of it),
   * concatenated in document order.
   */
  expandSection(sourcePath: string, headingPath: string[]): {
    sourcePath: string;
    headingPath: string[];
    text: string;
  } | null {
    const inSource = this.chunks
      .filter((c) => c.sourcePath === sourcePath)
      .sort((a, b) => a.ordinal - b.ordinal);
    if (inSource.length === 0) return null;

    const key = headingPath.join('\u0000');
    const matching = inSource.filter((c) => {
      const ck = c.headingPath.join('\u0000');
      return ck === key || ck.startsWith(key + '\u0000');
    });
    const section = matching.length ? matching : inSource;
    return {
      sourcePath,
      headingPath,
      text: section.map((c) => c.text).join('\n\n'),
    };
  }
}
