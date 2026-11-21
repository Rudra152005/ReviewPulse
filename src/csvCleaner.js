import { parse } from 'csv-parse/sync';

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
 * Parses raw CSV content into initial row records with basic sanitisation.
 * Multi-line quoted cells are supported by csv-parse.
 * @param {string|Buffer} csvContent 
 * @returns {Array<object>}
 */
export function parseCsvRows(csvContent) {
  const content = typeof csvContent === 'string' ? csvContent : csvContent.toString('utf-8');
  
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true
  });

  return records.map((record, index) => {
    const rawText = record.review_text ?? '';
    const cleanedText = cleanText(rawText);
    const parsedRating = parseRating(record.rating);

    return {
      review_id: (record.review_id || `ROW_${index + 1}`).trim(),
      product: (record.product || 'Unknown Product').trim(),
      rating: parsedRating,
      raw_rating: record.rating !== undefined ? String(record.rating).trim() : '',
      date: (record.date || '').trim(),
      cleaned_text: cleanedText,
      raw_text: rawText,
      is_empty: cleanedText.length === 0
    };
  });
}
