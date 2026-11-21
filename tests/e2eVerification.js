import fs from 'node:fs';
import { processReviewsCsv } from '../src/csvCleaner.js';
import { analyzeReviews } from '../src/analyzer.js';
import { computeDashboardStats, generateTopInsights } from '../src/insights.js';
import { AnalysisCache } from '../src/cache.js';

console.log('=== RUNNING END-TO-END PIPELINE VERIFICATION ===');

const csvContent = fs.readFileSync('reviews.csv', 'utf-8');
const testCache = new AnalysisCache('data/e2e_verification_cache.json');
testCache.clear();

let llmCallCount = 0;

// Realistic mock simulating Gemini 2.5 Flash classification
const mockGemini = async ({ prompt, responseSchema }) => {
  llmCallCount++;
  // Parse incoming JSON batch
  const jsonMatch = prompt.match(/Input Reviews:\s*(\[[\s\S]*\])/);
  if (!jsonMatch) throw new Error('Invalid prompt structure');
  const batch = JSON.parse(jsonMatch[1]);

  const results = batch.map((item) => {
    const id = item.review_id;
    let sentiment = 'positive';
    let topics = ['quality'];
    let summary = 'Good product';
    let needs_reply = false;

    if (id === 'R001') {
      sentiment = 'positive';
      topics = ['quality', 'price'];
      summary = 'Super soft fabric that does not fade after washes.';
      needs_reply = false;
    } else if (id === 'R002') {
      sentiment = 'negative';
      topics = ['size_fit'];
      summary = 'Received queen size instead of ordered king size.';
      needs_reply = true;
    } else if (id === 'R003') {
      // Sarcasm
      sentiment = 'negative';
      topics = ['delivery'];
      summary = 'Sarcastic review criticizing 3-week delivery delay.';
      needs_reply = true;
    } else if (id === 'R004') {
      // Hinglish
      sentiment = 'neutral';
      topics = ['quality', 'packaging'];
      summary = 'Good product quality but arrived with badly torn box packaging.';
      needs_reply = true;
    } else if (id === 'R007') {
      sentiment = 'negative';
      topics = ['quality', 'support'];
      summary = 'One broken mug, no refund after 6 days of contacting support.';
      needs_reply = true;
    } else if (id === 'R008') {
      // Rating mismatch: 5 stars, negative text
      sentiment = 'negative';
      topics = ['quality'];
      summary = 'Handles fell off within a week; terrible quality.';
      needs_reply = true;
    } else if (id === 'R009') {
      // Emoji only
      sentiment = 'positive';
      topics = ['other'];
      summary = 'Only emojis, appears positive.';
      needs_reply = false;
    } else if (id === 'R010') {
      // Missing rating
      sentiment = 'neutral';
      topics = ['quality', 'price'];
      summary = 'Good quality but overpriced compared to local market.';
      needs_reply = false;
    } else if (id === 'R012') {
      // Prompt injection
      sentiment = 'negative';
      topics = ['quality'];
      summary = 'Left earbud stopped working after two days.';
      needs_reply = true;
    } else if (id === 'R016') {
      // Devanagari Hindi
      sentiment = 'neutral';
      topics = ['quality'];
      summary = 'Good sound quality but battery drains very quickly.';
      needs_reply = false;
    } else if (id === 'R020') {
      sentiment = 'negative';
      topics = ['quality'];
      summary = 'Received a dirty used pair with mud on the soles.';
      needs_reply = true;
    } else if (id === 'R022') {
      // Non-numeric rating "five"
      sentiment = 'positive';
      topics = ['quality'];
      summary = 'Best shoes bought online, highly satisfied.';
      needs_reply = false;
    } else if (id === 'R024') {
      // HTML tags
      sentiment = 'positive';
      topics = ['quality'];
      summary = 'Keeps desk clean and has a pleasant bamboo scent.';
      needs_reply = false;
    } else if (id === 'R027') {
      sentiment = 'negative';
      topics = ['delivery', 'support'];
      summary = 'Package marked delivered but never arrived; support unresponsive.';
      needs_reply = true;
    } else {
      sentiment = 'positive';
      topics = ['quality'];
      summary = 'Satisfied with product overall.';
      needs_reply = false;
    }

    return {
      review_id: id,
      sentiment,
      topics,
      summary,
      needs_reply
    };
  });

  return { text: JSON.stringify(results) };
};

// First Run
console.log('\n--- FIRST RUN (Empty Cache) ---');
const cleanResult1 = processReviewsCsv(csvContent);
console.log('1. CSV Data Quality Report:');
console.log(JSON.stringify(cleanResult1.dataQualityReport, null, 2));

const analysisResult1 = await analyzeReviews({
  validReviews: cleanResult1.validReviews,
  duplicateReviews: cleanResult1.duplicateReviews,
  cache: testCache,
  llmCaller: mockGemini,
  batchSize: 5
});

const allCompleteReviews1 = [
  ...analysisResult1.allReviews,
  ...cleanResult1.skippedReviews
];

const stats1 = computeDashboardStats(allCompleteReviews1);
console.log('2. Dashboard Stats:');
console.log({
  totalAnalysed: stats1.totalAnalysed,
  sentimentCounts: stats1.sentimentCounts,
  sentimentPercent: stats1.sentimentPercent,
  needsReply: stats1.needsReplyCount,
  ratingAgreement: stats1.ratingAgreement
});

console.log('3. LLM Calls made on Run 1:', llmCallCount);

// Specific Verification Checks
const r005 = allCompleteReviews1.find((r) => r.review_id === 'R005');
console.log('R005 status:', r005?.status, 'skip_reason:', r005?.skip_reason);
if (r005?.status !== 'skipped' || r005?.skip_reason !== 'skipped: empty') {
  throw new Error('R005 check failed!');
}

const r015 = allCompleteReviews1.find((r) => r.review_id === 'R015');
console.log('R015 duplicate_of:', r015?.duplicate_of, 'sentiment:', r015?.sentiment);
if (!r015?.is_duplicate || r015?.duplicate_of !== 'R012') {
  throw new Error('R015 duplicate check failed!');
}

const r010 = allCompleteReviews1.find((r) => r.review_id === 'R010');
console.log('R010 rating:', r010?.rating, 'raw_rating:', r010?.raw_rating);
if (r010?.rating !== null) throw new Error('R010 rating check failed!');

const r022 = allCompleteReviews1.find((r) => r.review_id === 'R022');
console.log('R022 rating:', r022?.rating, 'raw_rating:', r022?.raw_rating);
if (r022?.rating !== null) throw new Error('R022 rating check failed!');

const r008 = allCompleteReviews1.find((r) => r.review_id === 'R008');
console.log('R008 rating:', r008?.rating, 'sentiment:', r008?.sentiment, 'mismatch:', r008?.rating_mismatch);
if (!r008?.rating_mismatch) throw new Error('R008 rating mismatch check failed!');

const r012 = allCompleteReviews1.find((r) => r.review_id === 'R012');
console.log('R012 sentiment:', r012?.sentiment, 'needs_reply:', r012?.needs_reply, 'injection flag:', r012?.possible_injection);
if (r012?.sentiment !== 'negative' || !r012?.needs_reply || !r012?.possible_injection) {
  throw new Error('R012 injection and negative check failed!');
}

// Second Run: Test Cache Hit (Zero LLM calls)
console.log('\n--- SECOND RUN (Testing Cache Hit) ---');
const prevCalls = llmCallCount;
const cleanResult2 = processReviewsCsv(csvContent);
const analysisResult2 = await analyzeReviews({
  validReviews: cleanResult2.validReviews,
  duplicateReviews: cleanResult2.duplicateReviews,
  cache: testCache,
  llmCaller: mockGemini,
  batchSize: 5
});

const newCallsOnRun2 = llmCallCount - prevCalls;
console.log('LLM calls made on Run 2:', newCallsOnRun2);
console.log('Cached reviews count on Run 2:', analysisResult2.stats.cached);

if (newCallsOnRun2 !== 0) {
  throw new Error(`Expected 0 LLM calls on second run, got ${newCallsOnRun2}`);
}

testCache.clear();
console.log('\n>>> ALL END-TO-END VERIFICATION CHECKS PASSED PERFECTLY! <<<');
