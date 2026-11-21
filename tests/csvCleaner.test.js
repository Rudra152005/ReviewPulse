import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  stripHtml,
  cleanText,
  parseRating,
  processReviewsCsv
} from '../src/csvCleaner.js';

describe('CSV Cleaner & Parser', () => {
  it('should strip HTML tags from text', () => {
    const raw = '<b>Love it!</b> Keeps my desk clean &amp; neat.';
    assert.equal(stripHtml(raw), 'Love it! Keeps my desk clean &amp; neat.');
  });

  it('should clean and collapse whitespace', () => {
    const raw = "Super  soft\nfabric,  colours\tdid not fade.";
    assert.equal(cleanText(raw), 'Super soft fabric, colours did not fade.');
  });

  it('should parse valid ratings 1-5 and return null for invalid/empty ratings', () => {
    assert.equal(parseRating('1'), 1);
    assert.equal(parseRating('5'), 5);
    assert.equal(parseRating(4), 4);
    assert.equal(parseRating('five'), null);
    assert.equal(parseRating(''), null);
    assert.equal(parseRating(' '), null);
    assert.equal(parseRating('0'), null);
    assert.equal(parseRating('6'), null);
    assert.equal(parseRating(null), null);
    assert.equal(parseRating(undefined), null);
  });

  it('should skip empty review text and flag with "skipped: empty"', () => {
    const csv = `review_id,product,rating,date,review_text\nR005,Cotton Bedsheet Set,5,2026-10-07,""`;
    const res = processReviewsCsv(csv);
    assert.equal(res.skippedReviews.length, 1);
    assert.equal(res.skippedReviews[0].review_id, 'R005');
    assert.equal(res.skippedReviews[0].skip_reason, 'skipped: empty');
    assert.equal(res.validReviews.length, 0);
  });

  it('should parse multi-line quoted cells and detect duplicates (R012 / R015)', () => {
    const csvPath = path.resolve(process.cwd(), 'reviews.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const res = processReviewsCsv(csvContent);

    // 30 total rows
    assert.equal(res.dataQualityReport.rowsRead, 30);
    // 28 unique valid reviews
    assert.equal(res.dataQualityReport.analysed, 28);
    // 1 empty review (R005)
    assert.equal(res.dataQualityReport.skippedEmpty, 1);
    // 1 duplicate (R015)
    assert.equal(res.dataQualityReport.duplicates, 1);
    // 2 unknown ratings (R010: empty, R022: 'five')
    assert.equal(res.dataQualityReport.unknownRatings, 2);

    // Verify R015 references R012
    const dup = res.duplicateReviews.find((r) => r.review_id === 'R015');
    assert.ok(dup);
    assert.equal(dup.is_duplicate, true);
    assert.equal(dup.duplicate_of, 'R012');

    // Verify multi-line review parsed cleanly
    const r001 = res.validReviews.find((r) => r.review_id === 'R001');
    assert.ok(r001);
    assert.match(r001.text, /Super soft fabric, colours did not fade after 3 washes/);
  });
});
