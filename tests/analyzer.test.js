import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReviews } from '../src/analyzer.js';
import { AnalysisCache } from '../src/cache.js';

describe('Analyzer Batching & Retry Orchestrator', () => {
  it('should succeed on retry if first LLM response is invalid', async () => {
    let callCount = 0;
    const testCache = new AnalysisCache('data/test_retry_cache.json');

    const mockLlm = async () => {
      callCount++;
      if (callCount === 1) {
        // Bad response: invalid sentiment
        return { text: JSON.stringify([{ review_id: 'R1', sentiment: 'SUPER_AWESOME' }]) };
      }
      // Retry response: perfectly valid
      return {
        text: JSON.stringify([
          {
            review_id: 'R1',
            sentiment: 'positive',
            topics: ['quality'],
            summary: 'Great quality bedsheet',
            needs_reply: false
          }
        ])
      };
    };

    const res = await analyzeReviews({
      validReviews: [{ review_id: 'R1', text: 'Great bedsheet', raw_text: 'Great bedsheet', hash: 'h_test1', product: 'Bedsheet' }],
      cache: testCache,
      llmCaller: mockLlm,
      batchSize: 5
    });

    assert.equal(callCount, 2, 'Should have called LLM twice (initial + 1 retry)');
    assert.equal(res.analysedReviews.length, 1);
    assert.equal(res.analysedReviews[0].status, 'analysed');
    assert.equal(res.analysedReviews[0].sentiment, 'positive');

    testCache.clear();
  });

  it('should isolate failure and mark as analysis_failed if invalid twice without crashing', async () => {
    let callCount = 0;
    const testCache = new AnalysisCache('data/test_failed_cache.json');

    const mockAlwaysInvalidLlm = async () => {
      callCount++;
      return { text: 'Not valid json at all {{ bad' };
    };

    const res = await analyzeReviews({
      validReviews: [{ review_id: 'R2', text: 'Broken item', raw_text: 'Broken item', hash: 'h_test2', product: 'Mug' }],
      cache: testCache,
      llmCaller: mockAlwaysInvalidLlm,
      batchSize: 5
    });

    assert.equal(callCount, 2, 'Should have retried once before failing');
    assert.equal(res.stats.failed, 1);
    assert.equal(res.allReviews[0].status, 'analysis_failed');
    assert.ok(res.allReviews[0].failure_reason);

    // Failed analysis should NEVER be stored in cache
    assert.equal(testCache.getReview('h_test2'), null);

    testCache.clear();
  });
});
