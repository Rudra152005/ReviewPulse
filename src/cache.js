import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CACHE_PATH = path.resolve(process.cwd(), 'data', 'cache.json');

/**
 * File-based persistent cache keyed by SHA-256 of normalised review text.
 * Persists to data/cache.json.
 */
export class AnalysisCache {
  constructor(filePath = DEFAULT_CACHE_PATH) {
    this.filePath = filePath;
    this.store = {
      reviews: {},
      replies: {},
      insights: {}
    };
    this.init();
  }

  /**
   * Initializes cache directory and loads existing cache if available.
   */
  init() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.store = {
          reviews: parsed.reviews || {},
          replies: parsed.replies || {},
          insights: parsed.insights || {}
        };
      } else {
        this.save();
      }
    } catch (err) {
      console.warn(`[Cache] Warning: could not initialize cache file (${err.message}). Using in-memory fallback.`);
      this.store = { reviews: {}, replies: {}, insights: {} };
    }
  }

  /**
   * Persists the current in-memory store to disk safely.
   */
  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (err) {
      console.warn(`[Cache] Warning: failed to save cache (${err.message})`);
    }
  }

  /**
   * Gets cached review analysis by SHA-256 hash.
   * @param {string} hash 
   * @returns {object|null}
   */
  getReview(hash) {
    if (!hash || !this.store.reviews[hash]) return null;
    return this.store.reviews[hash];
  }

  /**
   * Caches review analysis.
   * Never caches failed analyses (status === 'analysis_failed').
   * @param {string} hash 
   * @param {object} analysis 
   */
  setReview(hash, analysis) {
    if (!hash || !analysis) return;
    // Explicit requirement: Do not cache analysis_failed results
    if (analysis.status === 'analysis_failed') return;

    this.store.reviews[hash] = {
      sentiment: analysis.sentiment,
      topics: analysis.topics,
      summary: analysis.summary,
      needs_reply: analysis.needs_reply,
      cached_at: new Date().toISOString()
    };
    this.save();
  }

  /**
   * Gets suggested reply by review hash.
   * @param {string} hash 
   * @returns {string|null}
   */
  getReply(hash) {
    return this.store.replies[hash] || null;
  }

  /**
   * Caches generated suggested reply.
   * @param {string} hash 
   * @param {string} reply 
   */
  setReply(hash, reply) {
    if (!hash || !reply) return;
    this.store.replies[hash] = reply;
    this.save();
  }

  /**
   * Gets cached top 3 praises/complaints insights.
   * @param {string} key 
   * @returns {object|null}
   */
  getInsights(key) {
    return this.store.insights[key] || null;
  }

  /**
   * Caches top 3 praises/complaints insights.
   * @param {string} key 
   * @param {object} insights 
   */
  setInsights(key, insights) {
    if (!key || !insights) return;
    this.store.insights[key] = insights;
    this.save();
  }

  /**
   * Clears the cache (primarily for tests).
   */
  clear() {
    this.store = { reviews: {}, replies: {}, insights: {} };
    this.save();
  }
}

export const defaultCache = new AnalysisCache();
