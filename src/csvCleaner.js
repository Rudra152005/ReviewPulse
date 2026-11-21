import { parse } from 'csv-parse/sync';
import crypto from 'node:crypto';

/**
 * Strips HTML tags from text.
 * Example: "<b>Love it!</b>" -> "Love it!"
 * @param {string} text 
 * @returns {string}
 */
export function stripHtml(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/<[^>]*>/g, '');
}

/**
 * Normalises text by stripping HTML tags and collapsing whitespace.
 * Preserves unicode characters (emojis, Hindi, Hinglish).
 * @param {string} text 
 * @returns {string}
 */
export function cleanText(text) {
  if (!text || typeof text !== 'string') return '';
  const noHtml = stripHtml(text);
  // Collapse tabs, newlines, and multi-spaces into a single space
  return noHtml.replace(/\s+/g, ' ').trim();
}

/**
 * Computes SHA-256 hash of normalised review text for cache keys and deduplication.
 * @param {string} text 
 * @returns {string}
 */
export function hashText(text) {
  return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

/**
 * Parses and validates star rating.
 * Valid ratings are integers 1 to 5.
 * Invalid ratings (e.g. "", "five", null, undefined) return null.
 * @param {string|number} rawRating 
 * @returns {number|null}
 */
export function parseRating(rawRating) {
  if (rawRating === undefined || rawRating === null) return null;
  const str = String(rawRating).trim();
  if (!str) return null;

  // Strict check: must be a single digit 1-5
  if (/^[1-5]$/.test(str)) {
    return parseInt(str, 10);
  }
  return null;
}

/**
 * Parses raw CSV content into records.
 * Supports multi-line quoted cells.
 * @param {string|Buffer} csvContent 
 * @returns {Array<object>}
 */
export function parseCsvRows(csvContent) {
  const content = typeof csvContent === 'string' ? csvContent : csvContent.toString('utf-8');
  
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true
  });
}

/**
 * Full cleaning and deduplication pipeline.
 * Handles:
 * - Empty/whitespace-only review text (skipped: empty)
 * - Missing/non-numeric rating -> null
 * - HTML stripping & whitespace collapsing
 * - Duplicate detection via lowercased normalised text
 * - Data quality summary report
 * 
 * @param {string|Buffer} csvContent 
 * @returns {{
 *   validReviews: Array<object>,
 *   duplicateReviews: Array<object>,
 *   skippedReviews: Array<object>,
 *   allReviews: Array<object>,
 *   dataQualityReport: {
 *     rowsRead: number,
 *     analysed: number,
 *     skippedEmpty: number,
 *     duplicates: number,
 *     unknownRatings: number
 *   }
 * }}
 */
export function processReviewsCsv(csvContent) {
  const rawRows = parseCsvRows(csvContent);
  const rowsRead = rawRows.length;

  const validReviews = [];
  const duplicateReviews = [];
  const skippedReviews = [];
  const allReviews = [];

  // Map of normalized lowercased text to original review_id
  const seenTexts = new Map();
  let unknownRatingsCount = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const reviewId = (row.review_id || `ROW_${i + 1}`).trim();
    const product = (row.product || 'Unknown Product').trim();
    const date = (row.date || '').trim();
    const rawRating = row.rating !== undefined ? String(row.rating).trim() : '';
    const rating = parseRating(rawRating);
    const cleaned = cleanText(row.review_text || '');
    const hash = hashText(cleaned);

    if (rating === null) {
      unknownRatingsCount++;
    }

    // Base review item
    const reviewItem = {
      review_id: reviewId,
      product,
      rating, // number or null
      raw_rating: rawRating,
      date,
      text: cleaned,
      raw_text: row.review_text || '',
      hash,
      is_duplicate: false,
      duplicate_of: null,
      status: 'pending', // 'analysed' | 'skipped' | 'duplicate' | 'analysis_failed'
      skip_reason: null
    };

    // Case 1: Empty or whitespace-only text
    if (cleaned.length === 0) {
      reviewItem.status = 'skipped';
      reviewItem.skip_reason = 'skipped: empty';
      skippedReviews.push(reviewItem);
      allReviews.push(reviewItem);
      continue;
    }

    // Case 2: Duplicate detection (lowercased, trimmed, whitespace-collapsed)
    const normalizedKey = cleaned.toLowerCase();
    if (seenTexts.has(normalizedKey)) {
      const originalId = seenTexts.get(normalizedKey);
      reviewItem.is_duplicate = true;
      reviewItem.duplicate_of = originalId;
      reviewItem.status = 'duplicate';
      duplicateReviews.push(reviewItem);
      allReviews.push(reviewItem);
      continue;
    }

    // Case 3: Valid unique review ready for analysis
    seenTexts.set(normalizedKey, reviewId);
    validReviews.push(reviewItem);
    allReviews.push(reviewItem);
  }

  const dataQualityReport = {
    rowsRead,
    analysed: validReviews.length,
    skippedEmpty: skippedReviews.length,
    duplicates: duplicateReviews.length,
    unknownRatings: unknownRatingsCount
  };

  return {
    validReviews,
    duplicateReviews,
    skippedReviews,
    allReviews,
    dataQualityReport
  };
}
