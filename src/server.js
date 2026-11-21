import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { processReviewsCsv } from './csvCleaner.js';
import { analyzeReviews } from './analyzer.js';
import { computeDashboardStats, generateTopInsights } from './insights.js';
import { generateSuggestedReply } from './replies.js';
import { defaultCache } from './cache.js';
import { llmMetrics } from './llmClient.js';
import fs from 'node:fs';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Setup Multer for in-memory file uploads (max 5MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), 'public')));

// In-memory job store for live progress tracking
const jobs = new Map();

/**
 * Executes full analysis workflow on CSV content.
 * @param {string|Buffer} csvContent 
 * @param {function} [onProgress] 
 * @returns {Promise<object>}
 */
async function runAnalysisPipeline(csvContent, onProgress = null) {
  const startTime = Date.now();
  const startCalls = llmMetrics.totalCalls;
  const startRetries = llmMetrics.retryCount;

  // 1. Parse, clean, and deduplicate CSV
  const {
    validReviews,
    duplicateReviews,
    skippedReviews,
    allReviews,
    dataQualityReport
  } = processReviewsCsv(csvContent);

  // 2. Batch analysis with caching and validation
  const analysisOutput = await analyzeReviews({
    validReviews,
    duplicateReviews,
    cache: defaultCache,
    onProgress
  });

  // Re-combine all reviews for display (including skipped empty)
  const completeReviewList = [
    ...analysisOutput.allReviews,
    ...skippedReviews
  ];

  // 3. Compute dashboard summary statistics and rating mismatch
  const dashboardStats = computeDashboardStats(completeReviewList);

  // 4. Generate Top 3 complaints & praises (1 compact LLM call or cached)
  const topInsights = await generateTopInsights(analysisOutput.analysedReviews, {
    cache: defaultCache
  });

  const durationMs = Date.now() - startTime;
  const callsMade = llmMetrics.totalCalls - startCalls;
  const retriesMade = llmMetrics.retryCount - startRetries;

  return {
    dataQualityReport,
    stats: dashboardStats,
    topInsights,
    reviews: completeReviewList,
    metrics: {
      totalAnalyzed: analysisOutput.stats.total,
      cachedHits: analysisOutput.stats.cached,
      newlyAnalyzed: analysisOutput.stats.newlyAnalysed,
      failedCount: analysisOutput.stats.failed,
      llmCallsMade: callsMade,
      retriesMade,
      durationMs
    }
  };
}

/**
 * Synchronous file upload and analysis endpoint.
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file && !req.body.csv) {
      return res.status(400).json({ error: 'Please upload a CSV file or provide CSV text.' });
    }

    const csvContent = req.file ? req.file.buffer.toString('utf-8') : req.body.csv;
    const result = await runAnalysisPipeline(csvContent);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Server] /api/upload error:', err);
    return res.status(500).json({ error: err.message || 'Analysis pipeline failed.' });
  }
});

/**
 * Asynchronous job creation for live progress bar polling.
 */
app.post('/api/jobs', upload.single('file'), async (req, res) => {
  try {
    if (!req.file && !req.body.csv) {
      return res.status(400).json({ error: 'Please upload a CSV file or provide CSV text.' });
    }

    const csvContent = req.file ? req.file.buffer.toString('utf-8') : req.body.csv;
    const jobId = crypto.randomUUID();

    jobs.set(jobId, {
      id: jobId,
      status: 'processing',
      progress: {
        processed: 0,
        total: 0,
        currentBatch: 0,
        totalBatches: 0
      },
      result: null,
      error: null,
      createdAt: Date.now()
    });

    // Start background analysis
    runAnalysisPipeline(csvContent, (progress) => {
      const job = jobs.get(jobId);
      if (job) {
        job.progress = progress;
      }
    })
      .then((result) => {
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'completed';
          job.result = result;
        }
      })
      .catch((err) => {
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = err.message || 'Job failed';
        }
      });

    return res.status(202).json({ jobId });
  } catch (err) {
    console.error('[Server] /api/jobs error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Poll job status and progress.
 */
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  return res.json(job);
});

/**
 * On-click suggested reply generation.
 */
app.post('/api/reply', async (req, res) => {
  try {
    const { review } = req.body;
    if (!review) {
      return res.status(400).json({ error: 'Review payload is required.' });
    }

    const replyData = await generateSuggestedReply(review, {
      cache: defaultCache
    });

    return res.json({ success: true, ...replyData });
  } catch (err) {
    console.error('[Server] /api/reply error:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate reply.' });
  }
});

/**
 * Serves the bundled reviews.csv so the user can test the app with 1 click.
 */
app.get('/api/sample', (req, res) => {
  try {
    const samplePath = path.resolve(process.cwd(), 'reviews.csv');
    if (fs.existsSync(samplePath)) {
      const content = fs.readFileSync(samplePath, 'utf-8');
      return res.type('text/csv').send(content);
    }
    return res.status(404).json({ error: 'Sample dataset reviews.csv not found' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Returns server metrics and cache stats.
 */
app.get('/api/metrics', (req, res) => {
  return res.json({
    llmMetrics,
    cachedReviewsCount: Object.keys(defaultCache.store.reviews).length,
    cachedRepliesCount: Object.keys(defaultCache.store.replies).length
  });
});

// Fallback index.html
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), 'public', 'index.html'));
});

// Start server if not imported as a module in tests or serverless environments
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`[ReviewLens] Server running at http://localhost:${port}`);
  });
}

export default app;
