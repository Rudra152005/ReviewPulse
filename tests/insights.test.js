import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRatingMismatch,
  computeDashboardStats,
  computeFallbackInsights
} from '../src/insights.js';

describe('Insights and Bonus Mismatch Telemetry', () => {
  it('should flag reviews where star rating contradicts sentiment', () => {
    // 5 stars with negative sentiment (e.g. R008: terrible review with 5 stars)
    assert.equal(checkRatingMismatch(5, 'negative'), true);
    assert.equal(checkRatingMismatch(4, 'negative'), true);

    // 1 or 2 stars with positive sentiment (sarcasm)
    assert.equal(checkRatingMismatch(1, 'positive'), true);
    assert.equal(checkRatingMismatch(2, 'positive'), true);

    // Agreeing ratings
    assert.equal(checkRatingMismatch(5, 'positive'), false);
    assert.equal(checkRatingMismatch(1, 'negative'), false);
    assert.equal(checkRatingMismatch(3, 'neutral'), false);

    // Unknown ratings (null) should be skipped
    assert.equal(checkRatingMismatch(null, 'positive'), false);
    assert.equal(checkRatingMismatch(null, 'negative'), false);
  });

  it('should compute correct rating agreement % and product breakdown', () => {
    const sampleReviews = [
      { status: 'analysed', rating: 5, sentiment: 'positive', product: 'Phone', topics: ['quality'], needs_reply: false },
      { status: 'analysed', rating: 1, sentiment: 'negative', product: 'Phone', topics: ['quality'], needs_reply: true },
      { status: 'analysed', rating: 5, sentiment: 'negative', product: 'Phone', topics: ['quality'], needs_reply: true }, // mismatch
      { status: 'analysed', rating: null, sentiment: 'positive', product: 'Case', topics: ['price'], needs_reply: false } // unknown rating
    ];

    const stats = computeDashboardStats(sampleReviews);
    assert.equal(stats.totalAnalysed, 4);
    assert.equal(stats.ratingAgreement.ratedReviews, 3);
    assert.equal(stats.ratingAgreement.mismatchCount, 1);
    assert.equal(stats.ratingAgreement.agreementPercent, 67); // 2 out of 3 match (67%)
    assert.equal(stats.productView.length, 2);
  });

  it('should generate deterministic fallback insights without crashing', () => {
    const sampleReviews = [
      { sentiment: 'negative', topics: ['support', 'delivery'], summary: 'Support never answered' },
      { sentiment: 'positive', topics: ['quality'], summary: 'High quality materials' }
    ];

    const fallback = computeFallbackInsights(sampleReviews);
    assert.equal(fallback.complaints.length, 3);
    assert.equal(fallback.praises.length, 3);
    assert.match(fallback.complaints[0], /SUPPORT|DELIVERY/);
    assert.match(fallback.praises[0], /QUALITY/);
  });
});
