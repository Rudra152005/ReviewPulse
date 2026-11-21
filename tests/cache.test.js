import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisCache } from '../src/cache.js';
import { analyzeReviews } from '../src/analyzer.js';

describe('Hash-based Cache Module', () => {
  it('should avoid any LLM calls on second run for already-analysed reviews', async () => {
    const testCache = new AnalysisCache('data/test_cache_run.json');
    testCache.clear();

    let llmCalls = 0;
    const mockLlm = async () => {
      llmCalls++;
      return {
        text: JSON.stringify([
          {
            review_id: 'R100',
            sentiment: 'positive',
            topics: ['delivery'],
            summary: 'Delivered fast',
            needs_reply: false
          }
        ])
      };
    };

    const review = {
      review_id: 'R100',
      text: 'Delivered fast',
      raw_text: 'Delivered fast',
      hash: 'sha256_mock_hash_123',
      product: 'Earbuds'
    };

    // First run -> calls LLM
    const run1 = await analyzeReviews({
      validReviews: [{ ...review }],
      cache: testCache,
      llmCaller: mockLlm
    });
    assert.equal(llmCalls, 1);
    assert.equal(run1.analysedReviews[0].is_cached, false);

    // Second run -> 0 LLM calls!
    const run2 = await analyzeReviews({
      validReviews: [{ ...review }],
      cache: testCache,
      llmCaller: mockLlm
    });
    assert.equal(llmCalls, 1, 'LLM calls must remain 1 (zero new calls on cached review)');
    assert.equal(run2.analysedReviews[0].is_cached, true);
    assert.equal(run2.analysedReviews[0].sentiment, 'positive');

    testCache.clear();
  });

  it('should store and retrieve suggested replies and insights by key', () => {
    const testCache = new AnalysisCache('data/test_replies_cache.json');
    testCache.clear();

    const reviewHash = 'hash_review_abc';
    const replyText = 'Thank you for your feedback! Please reach out to support@store.com.';

    testCache.setReply(reviewHash, replyText);
    assert.equal(testCache.getReply(reviewHash), replyText);

    testCache.setInsights('insights_key_1', {
      complaints: ['Complaint 1'],
      praises: ['Praise 1']
    });
    const insights = testCache.getInsights('insights_key_1');
    assert.equal(insights.complaints[0], 'Complaint 1');

    testCache.clear();
  });
});
