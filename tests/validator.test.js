import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateReviewItem, validateBatchAnalysis } from '../src/validator.js';

describe('Response Validator Module', () => {
  const sampleValidItem = {
    review_id: 'R001',
    sentiment: 'positive',
    topics: ['quality', 'price'],
    summary: 'Soft sheets with colors that do not fade.',
    needs_reply: false
  };

  it('should accept a completely valid review analysis object', () => {
    const res = validateReviewItem(sampleValidItem);
    assert.equal(res.isValid, true);
  });

  it('should reject invalid sentiment values', () => {
    const invalid = { ...sampleValidItem, sentiment: 'extremely_good' };
    const res = validateReviewItem(invalid);
    assert.equal(res.isValid, false);
    assert.match(res.error, /sentiment/);
  });

  it('should reject empty topics array or unknown topics', () => {
    const emptyTopics = { ...sampleValidItem, topics: [] };
    assert.equal(validateReviewItem(emptyTopics).isValid, false);

    const unknownTopic = { ...sampleValidItem, topics: ['durability', 'speed'] };
    assert.equal(validateReviewItem(unknownTopic).isValid, false);
  });

  it('should reject non-boolean needs_reply', () => {
    const stringReply = { ...sampleValidItem, needs_reply: 'false' };
    assert.equal(validateReviewItem(stringReply).isValid, false);

    const nullReply = { ...sampleValidItem, needs_reply: null };
    assert.equal(validateReviewItem(nullReply).isValid, false);
  });

  it('should reject empty or non-string summary', () => {
    const emptySummary = { ...sampleValidItem, summary: '   ' };
    assert.equal(validateReviewItem(emptySummary).isValid, false);

    const numberSummary = { ...sampleValidItem, summary: 12345 };
    assert.equal(validateReviewItem(numberSummary).isValid, false);
  });

  it('should validate batch responses and catch missing review IDs', () => {
    const expectedBatch = [{ review_id: 'R001' }, { review_id: 'R002' }];
    const partialResponse = [
      {
        review_id: 'R001',
        sentiment: 'positive',
        topics: ['quality'],
        summary: 'Good product',
        needs_reply: false
      }
    ];

    const res = validateBatchAnalysis(partialResponse, expectedBatch);
    assert.equal(res.isValid, false);
    assert.ok(res.errors.some((e) => e.includes('Missing expected review_id')));
  });

  it('should successfully parse markdown-wrapped JSON arrays', () => {
    const expectedBatch = [{ review_id: 'R001' }];
    const wrappedJson = '```json\n[{"review_id":"R001","sentiment":"neutral","topics":["other"],"summary":"Ok","needs_reply":false}]\n```';
    
    const res = validateBatchAnalysis(wrappedJson, expectedBatch);
    assert.equal(res.isValid, true);
    assert.equal(res.data[0].review_id, 'R001');
  });
});
