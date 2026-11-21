import { defaultCache } from './cache.js';
import { callGemini } from './llmClient.js';
import {
  ANALYSIS_SYSTEM_INSTRUCTION,
  BATCH_ANALYSIS_SCHEMA,
  buildBatchPrompt,
  buildRetryPrompt,
  detectPromptInjection
} from './prompts.js';
import { validateBatchAnalysis } from './validator.js';

/**
 * Splits an array into chunks of the given size.
 * @param {Array} arr 
 * @param {number} size 
 * @returns {Array<Array>}
 */
export function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Orchestrates batch review analysis with:
 * - Hash-based cache lookup (0 LLM calls for cached reviews)
 * - Sequential or controlled concurrency batching (default batch size 5)
 * - Server-side prompt injection detection flagging
 * - Strict schema validation with single retry on failure
 * - Graceful failure isolation ('analysis_failed' status without crashing)
 * 
 * @param {object} options
 * @param {Array<object>} options.validReviews - Non-empty unique reviews from CSV parser
 * @param {Array<object>} [options.duplicateReviews=[]] - Duplicate reviews to backfill
 * @param {import('./cache.js').AnalysisCache} [options.cache=defaultCache] - Cache instance
 * @param {function} [options.llmCaller=callGemini] - Injectable LLM caller
 * @param {number} [options.batchSize] - Batch size (defaults to env BATCH_SIZE or 5)
 * @param {function} [options.onProgress] - Optional progress callback
 * @returns {Promise<{
 *   analysedReviews: Array<object>,
 *   allReviews: Array<object>,
 *   stats: { total: number, cached: number, newlyAnalysed: number, failed: number }
 * }>}
 */
export async function analyzeReviews({
  validReviews,
  duplicateReviews = [],
  cache = defaultCache,
  llmCaller = callGemini,
  batchSize = parseInt(process.env.BATCH_SIZE, 10) || 5,
  onProgress = null
}) {
  const resultMap = new Map();
  const uncachedReviews = [];
  let cachedCount = 0;

  // Step 1: Check cache and inject server-side injection heuristic flags
  for (const review of validReviews) {
    // Flag prompt injection heuristics
    review.possible_injection = detectPromptInjection(review.raw_text);

    const cachedData = cache.getReview(review.hash);
    if (cachedData) {
      cachedCount++;
      review.status = 'analysed';
      review.sentiment = cachedData.sentiment;
      review.topics = cachedData.topics;
      review.summary = cachedData.summary;
      review.needs_reply = cachedData.needs_reply;
      review.is_cached = true;
      resultMap.set(review.review_id, review);
    } else {
      review.is_cached = false;
      uncachedReviews.push(review);
    }
  }

  // Step 2: Process uncached reviews in batches
  const batches = chunkArray(uncachedReviews, batchSize);
  let processedUncachedCount = 0;
  let failedCount = 0;

  if (onProgress) {
    onProgress({
      processed: cachedCount,
      total: validReviews.length,
      currentBatch: 0,
      totalBatches: batches.length
    });
  }

  for (let bIndex = 0; bIndex < batches.length; bIndex++) {
    const batch = batches[bIndex];
    let validation = null;

    try {
      // First attempt
      const prompt = buildBatchPrompt(batch);
      const response = await llmCaller({
        prompt,
        systemInstruction: ANALYSIS_SYSTEM_INSTRUCTION,
        responseSchema: BATCH_ANALYSIS_SCHEMA
      });

      validation = validateBatchAnalysis(response.text, batch);

      // If invalid, retry ONCE with strict reminder
      if (!validation.isValid) {
        console.warn(`[Analyzer] Batch ${bIndex + 1} validation failed on attempt 1. Retrying once... Errors:`, validation.errors);
        
        const retryPrompt = buildRetryPrompt(batch, validation.errors.join('; '));
        const retryResponse = await llmCaller({
          prompt: retryPrompt,
          systemInstruction: ANALYSIS_SYSTEM_INSTRUCTION,
          responseSchema: BATCH_ANALYSIS_SCHEMA
        });

        validation = validateBatchAnalysis(retryResponse.text, batch);
      }
    } catch (llmErr) {
      console.error(`[Analyzer] LLM call error for batch ${bIndex + 1}:`, llmErr.message);
      validation = {
        isValid: false,
        data: null,
        errors: [llmErr.message]
      };
    }

    // Step 3: Handle results or mark as analysis_failed
    if (validation && validation.isValid && Array.isArray(validation.data)) {
      const dataMap = new Map(validation.data.map((item) => [item.review_id, item]));

      for (const review of batch) {
        const item = dataMap.get(review.review_id);
        if (item) {
          review.status = 'analysed';
          review.sentiment = item.sentiment;
          review.topics = item.topics;
          review.summary = item.summary;
          review.needs_reply = item.needs_reply;

          // Cache successful result (never cache failed)
          cache.setReview(review.hash, review);
        } else {
          review.status = 'analysis_failed';
          review.failure_reason = 'Review ID missing in LLM response';
          failedCount++;
        }
        resultMap.set(review.review_id, review);
      }
    } else {
      // Both attempts failed or error occurred -> isolate failure gracefully
      const errReason = validation?.errors?.join('; ') || 'Analysis failed after retry';
      console.warn(`[Analyzer] Marking batch ${bIndex + 1} as analysis_failed. Reason: ${errReason}`);

      for (const review of batch) {
        review.status = 'analysis_failed';
        review.failure_reason = errReason;
        review.sentiment = null;
        review.topics = [];
        review.summary = 'Analysis failed';
        review.needs_reply = false;
        failedCount++;
        resultMap.set(review.review_id, review);
      }
    }

    processedUncachedCount += batch.length;
    if (onProgress) {
      onProgress({
        processed: cachedCount + processedUncachedCount,
        total: validReviews.length,
        currentBatch: bIndex + 1,
        totalBatches: batches.length
      });
    }
  }

  // Step 4: Backfill duplicate reviews from their originals
  for (const dup of duplicateReviews) {
    const original = resultMap.get(dup.duplicate_of);
    if (original && original.status === 'analysed') {
      dup.sentiment = original.sentiment;
      dup.topics = [...original.topics];
      dup.summary = original.summary;
      dup.needs_reply = original.needs_reply;
      dup.possible_injection = original.possible_injection;
    }
    resultMap.set(dup.review_id, dup);
  }

  const allReviewsList = Array.from(resultMap.values());
  const analysedList = allReviewsList.filter((r) => r.status === 'analysed');

  return {
    analysedReviews: analysedList,
    allReviews: allReviewsList,
    stats: {
      total: validReviews.length,
      cached: cachedCount,
      newlyAnalysed: uncachedReviews.length - failedCount,
      failed: failedCount
    }
  };
}
