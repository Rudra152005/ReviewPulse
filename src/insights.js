import { defaultCache } from './cache.js';
import { callGemini } from './llmClient.js';
import { hashText } from './csvCleaner.js';

/**
 * Checks if star rating contradicts the AI sentiment.
 * Valid ratings: 1-5.
 * Mismatch defined as:
 * - 4 or 5 stars with 'negative' sentiment (e.g. R008: 5 stars + terrible review)
 * - 1 or 2 stars with 'positive' sentiment (e.g. sarcastic praise)
 * Unknown ratings (null) are skipped.
 * 
 * @param {number|null} rating 
 * @param {string} sentiment 
 * @returns {boolean}
 */
export function checkRatingMismatch(rating, sentiment) {
  if (rating === null || rating === undefined || !sentiment) return false;
  if ((rating >= 4 && sentiment === 'negative') || (rating <= 2 && sentiment === 'positive')) {
    return true;
  }
  return false;
}

/**
 * Computes dashboard statistics:
 * - Total analysed, sentiment counts & percentages
 * - Reviews needing reply count
 * - Rating vs sentiment agreement percentage (bonus)
 * - Per-product sentiment breakdown (bonus)
 * 
 * @param {Array<object>} allReviews 
 * @returns {object}
 */
export function computeDashboardStats(allReviews) {
  // Only valid analysed reviews count towards sentiment stats
  const analysed = allReviews.filter((r) => r.status === 'analysed');
  const total = analysed.length;

  let positiveCount = 0;
  let neutralCount = 0;
  let negativeCount = 0;
  let needsReplyCount = 0;

  let ratedCount = 0;
  let agreementCount = 0;
  let mismatchCount = 0;

  // Product breakdown map
  const productStats = {};

  for (const review of analysed) {
    // Sentiment
    if (review.sentiment === 'positive') positiveCount++;
    else if (review.sentiment === 'neutral') neutralCount++;
    else if (review.sentiment === 'negative') negativeCount++;

    // Reply
    if (review.needs_reply) needsReplyCount++;

    // Mismatch check (skip unknown ratings)
    if (review.rating !== null && review.rating !== undefined) {
      ratedCount++;
      const isMismatch = checkRatingMismatch(review.rating, review.sentiment);
      review.rating_mismatch = isMismatch;
      if (isMismatch) {
        mismatchCount++;
      } else {
        agreementCount++;
      }
    } else {
      review.rating_mismatch = false;
    }

    // Product breakdown
    const prodName = review.product || 'Unknown Product';
    if (!productStats[prodName]) {
      productStats[prodName] = {
        name: prodName,
        total: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        needsReply: 0,
        topTopics: {}
      };
    }
    const p = productStats[prodName];
    p.total++;
    if (review.sentiment === 'positive') p.positive++;
    if (review.sentiment === 'neutral') p.neutral++;
    if (review.sentiment === 'negative') p.negative++;
    if (review.needs_reply) p.needsReply++;

    if (Array.isArray(review.topics)) {
      for (const t of review.topics) {
        p.topTopics[t] = (p.topTopics[t] || 0) + 1;
      }
    }
  }

  const sentimentPercent = {
    positive: total > 0 ? Math.round((positiveCount / total) * 100) : 0,
    neutral: total > 0 ? Math.round((neutralCount / total) * 100) : 0,
    negative: total > 0 ? Math.round((negativeCount / total) * 100) : 0
  };

  const agreementPercent = ratedCount > 0 ? Math.round((agreementCount / ratedCount) * 100) : 100;

  // Convert product stats map to array with sorted top topics
  const productView = Object.values(productStats).map((prod) => ({
    product: prod.name,
    total: prod.total,
    positive: prod.positive,
    neutral: prod.neutral,
    negative: prod.negative,
    needsReply: prod.needsReply,
    positivePercent: prod.total > 0 ? Math.round((prod.positive / prod.total) * 100) : 0,
    negativePercent: prod.total > 0 ? Math.round((prod.negative / prod.total) * 100) : 0,
    topTopics: Object.entries(prod.topTopics)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({ topic, count }))
  }));

  return {
    totalAnalysed: total,
    sentimentCounts: {
      positive: positiveCount,
      neutral: neutralCount,
      negative: negativeCount
    },
    sentimentPercent,
    needsReplyCount,
    ratingAgreement: {
      ratedReviews: ratedCount,
      agreementPercent,
      mismatchCount
    },
    productView
  };
}

/**
 * Deterministic fallback to compute top 3 complaints and praises
 * from topic frequencies and summaries if LLM call fails.
 * 
 * @param {Array<object>} analysedReviews 
 * @returns {{ complaints: Array<string>, praises: Array<string> }}
 */
export function computeFallbackInsights(analysedReviews) {
  const negativeReviews = analysedReviews.filter((r) => r.sentiment === 'negative');
  const positiveReviews = analysedReviews.filter((r) => r.sentiment === 'positive');

  // Topic frequencies
  const countTopics = (list) => {
    const counts = {};
    for (const r of list) {
      if (Array.isArray(r.topics)) {
        for (const t of r.topics) {
          counts[t] = (counts[t] || 0) + 1;
        }
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };

  const topNegTopics = countTopics(negativeReviews).slice(0, 3);
  const topPosTopics = countTopics(positiveReviews).slice(0, 3);

  const complaints = topNegTopics.map(([topic, count]) => {
    const sample = negativeReviews.find((r) => r.topics?.includes(topic));
    const desc = sample ? sample.summary : `Issues related to ${topic}`;
    return `${topic.toUpperCase()} (${count} reports): ${desc}`;
  });

  const praises = topPosTopics.map(([topic, count]) => {
    const sample = positiveReviews.find((r) => r.topics?.includes(topic));
    const desc = sample ? sample.summary : `Customers satisfied with ${topic}`;
    return `${topic.toUpperCase()} (${count} praises): ${desc}`;
  });

  while (complaints.length < 3) complaints.push('No significant complaints detected.');
  while (praises.length < 3) praises.push('No significant praises detected.');

  return { complaints, praises };
}

/**
 * Generates Top 3 Complaints and Top 3 Praises across all products.
 * Uses ONE compact LLM call with summaries/topics (not raw review text),
 * cached by input hash, with deterministic fallback.
 * 
 * @param {Array<object>} analysedReviews 
 * @param {object} options
 * @param {function} [options.llmCaller=callGemini]
 * @param {import('./cache.js').AnalysisCache} [options.cache=defaultCache]
 * @returns {Promise<{ complaints: Array<string>, praises: Array<string>, source: 'llm'|'fallback'|'cache' }>}
 */
export async function generateTopInsights(analysedReviews, { llmCaller = callGemini, cache = defaultCache } = {}) {
  if (!analysedReviews || analysedReviews.length === 0) {
    return {
      complaints: ['No complaints available.'],
      praises: ['No praises available.'],
      source: 'fallback'
    };
  }

  // Create a stable cache key based on sorted IDs and summaries
  const keyBasis = analysedReviews
    .map((r) => `${r.review_id}:${r.sentiment}:${r.summary}`)
    .sort()
    .join('|');
  const cacheKey = hashText(keyBasis);

  const cached = cache.getInsights(cacheKey);
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  // Prepare compact representation (only sentiment, topic, and summary)
  const compactPayload = analysedReviews.map((r) => ({
    product: r.product,
    sentiment: r.sentiment,
    topics: r.topics,
    summary: r.summary
  }));

  const systemInstruction = `You are an expert e-commerce business analyst.
Given structured customer review summaries, identify the top 3 store-wide complaints and top 3 store-wide praises.
Output strict JSON matching the schema:
{
  "complaints": ["Complaint 1", "Complaint 2", "Complaint 3"],
  "praises": ["Praise 1", "Praise 2", "Praise 3"]
}
Keep each point concise (1-2 sentences), actionable, and backed by customer feedback.`;

  const schema = {
    type: 'OBJECT',
    properties: {
      complaints: {
        type: 'ARRAY',
        items: { type: 'STRING' }
      },
      praises: {
        type: 'ARRAY',
        items: { type: 'STRING' }
      }
    },
    required: ['complaints', 'praises']
  };

  const prompt = `Here are the analysed review summaries across all products:
${JSON.stringify(compactPayload, null, 2)}

Provide the top 3 complaints and top 3 praises across all products.`;

  try {
    const response = await llmCaller({
      prompt,
      systemInstruction,
      responseSchema: schema
    });

    let cleanText = response.text.trim();
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.slice(7).replace(/```$/, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.slice(3).replace(/```$/, '').trim();
    }

    const parsed = JSON.parse(cleanText);

    if (
      Array.isArray(parsed.complaints) &&
      Array.isArray(parsed.praises) &&
      parsed.complaints.length > 0 &&
      parsed.praises.length > 0
    ) {
      const result = {
        complaints: parsed.complaints.slice(0, 3),
        praises: parsed.praises.slice(0, 3)
      };
      cache.setInsights(cacheKey, result);
      return { ...result, source: 'llm' };
    }
  } catch (err) {
    console.warn(`[Insights] LLM top insights generation failed (${err.message}). Using deterministic fallback.`);
  }

  // Deterministic fallback
  const fallback = computeFallbackInsights(analysedReviews);
  return { ...fallback, source: 'fallback' };
}
