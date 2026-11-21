import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callGemini, llmMetrics } from '../src/llmClient.js';

describe('LLM Client with Exponential Backoff and Retries', () => {
  it('should retry on HTTP 429 and succeed on subsequent 200 with injected sleep', async () => {
    llmMetrics.reset();
    let calls = 0;
    const sleeps = [];
    const mockSleep = async (ms) => { sleeps.push(ms); };

    const mockFetch = async () => {
      calls++;
      if (calls === 1) {
        return {
          status: 429,
          ok: false,
          headers: new Map([['retry-after', '2']]),
          text: async () => 'Rate limit exceeded'
        };
      }
      return {
        status: 200,
        ok: true,
        headers: new Map(),
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify([{ review_id: 'R1', sentiment: 'positive' }]) }]
              }
            }
          ]
        })
      };
    };

    const result = await callGemini({
      prompt: 'Test prompt',
      apiKey: 'test-fake-key',
      sleep: mockSleep,
      fetchFn: mockFetch,
      maxRetries: 3
    });

    assert.equal(calls, 2);
    assert.equal(sleeps.length, 1);
    assert.equal(sleeps[0], 2000); // 2 seconds from retry-after
    assert.ok(result.text.includes('R1'));
    assert.equal(result.attempts, 2);
  });

  it('should exhaust retries and throw error on continuous 429', async () => {
    const mockSleep = async () => {};
    let calls = 0;

    const mockFetch = async () => {
      calls++;
      return {
        status: 429,
        ok: false,
        headers: new Map(),
        text: async () => 'Resource exhausted'
      };
    };

    await assert.rejects(
      async () => {
        await callGemini({
          prompt: 'Test prompt',
          apiKey: 'test-fake-key',
          sleep: mockSleep,
          fetchFn: mockFetch,
          maxRetries: 2,
          baseDelayMs: 10
        });
      },
      (err) => {
        assert.match(err.message, /Gemini API request failed after 2 retries/);
        return true;
      }
    );

    // Initial attempt + 2 retries = 3 total attempts
    assert.equal(calls, 3);
  });
});
