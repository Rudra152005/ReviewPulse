import { ALLOWED_SENTIMENTS, ALLOWED_TOPICS } from './prompts.js';

/**
 * Validates a single review analysis object against the strict assessment schema.
 * 
 * Requirements:
 * - review_id: non-empty string
 * - sentiment: "positive" | "neutral" | "negative"
 * - topics: non-empty array containing only allowed topic strings
 * - summary: non-empty string
 * - needs_reply: boolean (true or false)
 * 
 * @param {any} item 
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateReviewItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { isValid: false, error: 'Review item must be an object' };
  }

  // 1. review_id
  if (typeof item.review_id !== 'string' || !item.review_id.trim()) {
    return { isValid: false, error: `Invalid or missing review_id: ${JSON.stringify(item.review_id)}` };
  }

  // 2. sentiment
  if (!ALLOWED_SENTIMENTS.includes(item.sentiment)) {
    return {
      isValid: false,
      error: `Review ${item.review_id}: sentiment '${item.sentiment}' must be one of [${ALLOWED_SENTIMENTS.join(', ')}]`
    };
  }

  // 3. topics (non-empty array, only allowed values)
  if (!Array.isArray(item.topics) || item.topics.length === 0) {
    return {
      isValid: false,
      error: `Review ${item.review_id}: topics must be a non-empty array`
    };
  }

  for (const topic of item.topics) {
    if (!ALLOWED_TOPICS.includes(topic)) {
      return {
        isValid: false,
        error: `Review ${item.review_id}: topic '${topic}' is not allowed. Allowed: [${ALLOWED_TOPICS.join(', ')}]`
      };
    }
  }

  // 4. summary (non-empty string)
  if (typeof item.summary !== 'string' || !item.summary.trim()) {
    return {
      isValid: false,
      error: `Review ${item.review_id}: summary must be a non-empty string`
    };
  }

  // 5. needs_reply (strict boolean)
  if (typeof item.needs_reply !== 'boolean') {
    return {
      isValid: false,
      error: `Review ${item.review_id}: needs_reply must be a boolean (got ${typeof item.needs_reply})`
    };
  }

  return { isValid: true };
}

/**
 * Validates a batch LLM response against expected review IDs.
 * Checks:
 * - Valid JSON array (handles JSON wrapped in code blocks or objects)
 * - Exact 1-to-1 matching of review IDs (no missing, no extra, no duplicate IDs)
 * - Each item passes validateReviewItem
 * 
 * @param {string|any} rawOutput - Raw string or parsed object from LLM
 * @param {Array<{ review_id: string }>} expectedBatch - The batch sent to LLM
 * @returns {{ isValid: boolean, data: Array<object> | null, errors: Array<string> }}
 */
export function validateBatchAnalysis(rawOutput, expectedBatch = []) {
  const errors = [];
  let parsed = null;

  // Step 1: Parse JSON safely
  if (typeof rawOutput === 'string') {
    let cleanStr = rawOutput.trim();
    // Strip accidental markdown code blocks
    if (cleanStr.startsWith('```json')) {
      cleanStr = cleanStr.slice(7).replace(/```$/, '').trim();
    } else if (cleanStr.startsWith('```')) {
      cleanStr = cleanStr.slice(3).replace(/```$/, '').trim();
    }

    try {
      parsed = JSON.parse(cleanStr);
    } catch (err) {
      return {
        isValid: false,
        data: null,
        errors: [`Invalid JSON output: ${err.message}`]
      };
    }
  } else {
    parsed = rawOutput;
  }

  // If model returned { reviews: [...] } instead of direct array, adapt safely
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.reviews)) {
    parsed = parsed.reviews;
  }

  if (!Array.isArray(parsed)) {
    return {
      isValid: false,
      data: null,
      errors: ['Response must be a JSON array of review objects']
    };
  }

  // Step 2: Validate review IDs matching expected batch
  const expectedIds = expectedBatch.map((r) => r.review_id);
  const expectedSet = new Set(expectedIds);
  const receivedIds = new Set();

  for (const item of parsed) {
    const itemValidation = validateReviewItem(item);
    if (!itemValidation.isValid) {
      errors.push(itemValidation.error);
      continue;
    }

    if (receivedIds.has(item.review_id)) {
      errors.push(`Duplicate review_id in response: ${item.review_id}`);
    }
    receivedIds.add(item.review_id);

    if (expectedBatch.length > 0 && !expectedSet.has(item.review_id)) {
      errors.push(`Unexpected review_id in response: ${item.review_id}`);
    }
  }

  // Check for missing expected IDs
  if (expectedBatch.length > 0) {
    for (const expectedId of expectedIds) {
      if (!receivedIds.has(expectedId)) {
        errors.push(`Missing expected review_id in response: ${expectedId}`);
      }
    }
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      data: null,
      errors
    };
  }

  return {
    isValid: true,
    data: parsed,
    errors: []
  };
}
