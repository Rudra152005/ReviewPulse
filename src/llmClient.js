import dotenv from 'dotenv';
dotenv.config();

/**
 * Default sleep function using setTimeout wrapped in a Promise.
 * Can be overridden in tests for instant execution.
 * @param {number} ms 
 * @returns {Promise<void>}
 */
export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Global call metrics tracker for cost and speed logging.
 */
export const llmMetrics = {
  totalCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  retryCount: 0,
  reset() {
    this.totalCalls = 0;
    this.successfulCalls = 0;
    this.failedCalls = 0;
    this.retryCount = 0;
  }
};

/**
 * Calls Google Gemini REST API with structured JSON output,
 * exponential backoff, jitter, and Retry-After header support.
 * 
 * Never logs or exposes the API key.
 * 
 * @param {object} options
 * @param {string} options.prompt - The user prompt
 * @param {string} [options.systemInstruction] - System instructions
 * @param {object} [options.responseSchema] - Optional JSON schema for response
 * @param {string} [options.model] - Gemini model name (defaults to process.env.GEMINI_MODEL or gemini-2.5-flash)
 * @param {string} [options.apiKey] - Gemini API key (defaults to process.env.GEMINI_API_KEY)
 * @param {number} [options.maxRetries=4] - Maximum retry attempts
 * @param {number} [options.baseDelayMs=1000] - Base delay for exponential backoff
 * @param {function} [options.sleep=defaultSleep] - Injectable sleep function
 * @param {function} [options.fetchFn=fetch] - Injectable fetch function
 * @returns {Promise<{ text: string, raw: object, attempts: number }>}
 */
export async function callGemini({
  prompt,
  systemInstruction,
  responseSchema,
  model = process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  apiKey = process.env.GEMINI_API_KEY,
  maxRetries = 4,
  baseDelayMs = 1000,
  sleep = defaultSleep,
  fetchFn = globalThis.fetch
}) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  if (responseSchema) {
    requestBody.generationConfig.responseSchema = responseSchema;
  }

  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt++;
    llmMetrics.totalCalls++;

    try {
      const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(requestBody)
      });

      // Handle 429 (Rate Limit) and 5xx (Server Error)
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        if (attempt > maxRetries) {
          llmMetrics.failedCalls++;
          const errorBody = await response.text().catch(() => '');
          throw new Error(`Gemini API request failed after ${maxRetries} retries. Status: ${response.status}. ${errorBody}`);
        }

        llmMetrics.retryCount++;

        // Honour Retry-After header if provided
        const retryAfterHeader = response.headers.get('retry-after');
        let delayMs = 0;

        if (retryAfterHeader) {
          const parsedSeconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
            delayMs = parsedSeconds * 1000;
          }
        }

        if (!delayMs) {
          // Exponential backoff + jitter (e.g. 1s, 2s, 4s, 8s + 0-500ms random jitter)
          const jitter = Math.floor(Math.random() * 500);
          delayMs = (baseDelayMs * Math.pow(2, attempt - 1)) + jitter;
        }

        console.warn(`[Gemini API] Received HTTP ${response.status}. Retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
        await sleep(delayMs);
        continue;
      }

      if (!response.ok) {
        llmMetrics.failedCalls++;
        const errorText = await response.text().catch(() => '');
        throw new Error(`Gemini API error (HTTP ${response.status}): ${errorText}`);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];

      if (!candidate) {
        throw new Error('Gemini API returned no candidates in response.');
      }

      const contentText = candidate.content?.parts?.[0]?.text;
      if (!contentText) {
        throw new Error(`Gemini API returned empty text part. FinishReason: ${candidate.finishReason || 'unknown'}`);
      }

      llmMetrics.successfulCalls++;
      return {
        text: contentText.trim(),
        raw: data,
        attempts: attempt
      };
    } catch (err) {
      // Check if network error and we have retries left
      const isNetworkError = err.name === 'FetchError' || err.code === 'ECONNRESET' || err.message?.includes('fetch failed');
      
      if (isNetworkError && attempt <= maxRetries) {
        llmMetrics.retryCount++;
        const jitter = Math.floor(Math.random() * 500);
        const delayMs = (baseDelayMs * Math.pow(2, attempt - 1)) + jitter;
        console.warn(`[Gemini API] Network error (${err.message}). Retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`);
        await sleep(delayMs);
        continue;
      }

      // If it's the last attempt or non-retryable error, fail
      if (attempt > maxRetries) {
        llmMetrics.failedCalls++;
      }
      throw err;
    }
  }
}
