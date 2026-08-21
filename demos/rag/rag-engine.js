/**
 * The RAG project's retrieval stack, ported to the browser.
 *
 * This is a port, not an impression. Dense search, BM25 and reciprocal rank
 * fusion are reimplemented from rag/retriever.py and rag/hybrid.py so the demo
 * ranks passages the way the Python service does, on the same vectors Chroma
 * holds. tools/verify_rag_engine.cjs checks every question in both retrieval
 * modes against golden.json, which the real Retriever produced — so "faithful"
 * is a thing that gets tested rather than claimed.
 *
 * The one stage that does not cross over is the cross-encoder reranker: it needs
 * a model, not a formula. Its effect is shown from recorded evaluation runs
 * instead of simulated here.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RagEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Python's `[^\W_]+` over a str is Unicode-aware, and JS `\w` is not — so the
  // class is spelled out. An ASCII-only [a-z0-9]+ would shred accented words
  // into fragments that then match unrelated passages.
  const TOKEN_RE = /[\p{L}\p{N}]+/gu;

  /** Case-fold and split into alphanumeric terms. Mirrors rag.hybrid.tokenize. */
  function tokenize(text) {
    return (text.toLowerCase().match(TOKEN_RE) || []);
  }

  /**
   * Chroma stores squared L2 distance, and langchain-chroma turns that into a
   * relevance score with `1 - distance / sqrt(2)`. The vectors are unit-norm, so
   * the squared distance is 2 - 2*cos and this is exactly what
   * similarity_search_with_relevance_scores returns.
   */
  function relevanceFromCosine(cos) {
    return 1 - (2 - 2 * cos) / Math.SQRT2;
  }

  function dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  }

  /** Okapi BM25 over the chunk texts, keyed by chunk id. Mirrors rag.hybrid.BM25Index. */
  class BM25Index {
    constructor(chunks, k1, b) {
      this.k1 = k1;
      this.b = b;
      this.ids = chunks.map((c) => c.id);
      this.docs = chunks.map((c) => tokenize(c.text));
      this.counts = this.docs.map((tokens) => {
        const counts = new Map();
        tokens.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
        return counts;
      });
      this.docFreq = new Map();
      this.docs.forEach((tokens) => {
        new Set(tokens).forEach((t) => this.docFreq.set(t, (this.docFreq.get(t) || 0) + 1));
      });
      const total = this.docs.reduce((sum, d) => sum + d.length, 0);
      this.avgLen = this.docs.length ? total / this.docs.length : 0;
    }

    /** Smoothed IDF: always positive, so a term in every document contributes ~0. */
    idf(term) {
      const n = this.docs.length;
      const df = this.docFreq.get(term) || 0;
      return Math.log(1 + (n - df + 0.5) / (df + 0.5));
    }

    /**
     * Up to `k` [chunkId, score] pairs, best first. Chunks scoring zero are
     * dropped rather than padded in — a channel with nothing to say should
     * contribute nothing to the fusion.
     */
    search(query, k) {
      const terms = tokenize(query);
      if (!terms.length || !this.docs.length) return [];

      const idf = new Map();
      new Set(terms).forEach((term) => idf.set(term, this.idf(term)));

      const scored = [];
      for (let i = 0; i < this.ids.length; i++) {
        const tokens = this.docs[i];
        if (!tokens.length) continue;
        const counts = this.counts[i];
        const norm = this.k1 * (1 - this.b + (this.b * tokens.length) / (this.avgLen || 1));
        let score = 0;
        idf.forEach((weight, term) => {
          const freq = counts.get(term);
          if (!freq) return;
          score += (weight * (freq * (this.k1 + 1))) / (freq + norm);
        });
        if (score > 0) scored.push([this.ids[i], score]);
      }

      // Stable sort by score; JS Array#sort is stable, matching Python's.
      scored.sort((x, y) => y[1] - x[1]);
      return scored.slice(0, k);
    }
  }

  /**
   * Fuse ranked id lists on rank rather than score: a cosine similarity and a
   * BM25 score share no scale, so any weighted sum of the two would be tuning a
   * meaningless constant. Ties break on first sighting, which makes the dense
   * channel — passed first — the tiebreaker.
   */
  function fuseRankings(rankings, k) {
    const order = new Map();
    rankings.forEach((ranking) =>
      ranking.forEach((id) => {
        if (!order.has(id)) order.set(id, order.size);
      })
    );
    const scores = new Map();
    rankings.forEach((ranking) =>
      ranking.forEach((id, i) => {
        scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1));
      })
    );
    return [...scores.entries()].sort(
      (x, y) => y[1] - x[1] || order.get(x[0]) - order.get(y[0])
    );
  }

  class Retriever {
    /** @param {object} corpus the exported corpus.json */
    constructor(corpus) {
      this.corpus = corpus;
      this.chunks = corpus.chunks;
      this.byId = new Map(corpus.chunks.map((c) => [c.id, c]));
      this.bm25 = new BM25Index(corpus.chunks, corpus.bm25.k1, corpus.bm25.b);
      this.rrfK = corpus.rrf_k;
      this.topK = corpus.top_k;
    }

    /** Every dense hit, ranked, numbered from 1. */
    dense(queryVec, fetchK) {
      return this.chunks
        .map((chunk) => ({
          chunk,
          chunkId: chunk.id,
          score: relevanceFromCosine(dot(queryVec, chunk.vec)),
          lexicalScore: null,
          fusionScore: null,
          foundByDense: true,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, fetchK)
        .map((hit, i) => Object.assign(hit, { index: i + 1 }));
    }

    /** Dense fused with the lexical channel by reciprocal rank. */
    hybrid(query, queryVec, fetchK) {
      const denseHits = this.dense(queryVec, fetchK);
      const byId = new Map(denseHits.map((hit) => [hit.chunkId, hit]));
      const denseRanking = denseHits.map((hit) => hit.chunkId);

      const lexical = this.bm25.search(query, fetchK);
      lexical.forEach(([chunkId, score]) => {
        const existing = byId.get(chunkId);
        if (existing) {
          existing.lexicalScore = score;
        } else if (this.byId.has(chunkId)) {
          // Pulled in by the lexical channel alone: it carries no dense score
          // because the dense channel never ranked it.
          byId.set(chunkId, {
            chunk: this.byId.get(chunkId),
            chunkId,
            score: 0,
            lexicalScore: score,
            fusionScore: null,
            foundByDense: false,
            index: byId.size + 1,
          });
        }
      });

      const fused = fuseRankings([denseRanking, lexical.map(([id]) => id)], this.rrfK);
      const ordered = [];
      fused.forEach(([chunkId, rrf]) => {
        const hit = byId.get(chunkId);
        if (!hit) return;
        hit.fusionScore = rrf;
        ordered.push(hit);
      });
      return ordered;
    }

    /**
     * Retrieve `k` passages through the configured pipeline.
     * @param {string} query raw query text, for the lexical channel
     * @param {number[]} queryVec its embedding, for the dense channel
     * @param {{mode?: 'dense'|'hybrid', k?: number}} options
     */
    search(query, queryVec, options) {
      const opts = options || {};
      const k = opts.k || this.topK;
      const mode = opts.mode || 'dense';
      const candidates =
        mode === 'hybrid'
          ? this.hybrid(query, queryVec, k).slice(0, k)
          : this.dense(queryVec, k);

      // Renumbering is not cosmetic: the context block renders [{index}] and
      // citation resolution looks markers back up by index, so a gap or a
      // duplicate turns a real citation into a dangling one.
      return candidates.slice(0, k).map((hit, i) => ({
        index: i + 1,
        chunk: hit.chunk,
        chunkId: hit.chunkId,
        score: hit.score,
        lexicalScore: hit.lexicalScore,
        fusionScore: hit.fusionScore,
        channel: hit.lexicalScore === null ? 'dense' : hit.foundByDense ? 'both' : 'lexical',
      }));
    }
  }

  /** Render retrieved chunks as the numbered context block sent to the model. */
  function formatContext(hits) {
    if (!hits.length) return '(no passages retrieved)';
    return hits
      .map((hit) => '[' + hit.index + '] source: ' + hit.chunk.source + '\n' + hit.chunk.text.trim())
      .join('\n\n---\n\n');
  }

  return { tokenize, relevanceFromCosine, BM25Index, fuseRankings, Retriever, formatContext };
});
