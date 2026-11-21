// ReviewLens Dashboard Client Application

let allReviews = [];
let dashboardStats = null;
let topInsights = null;
let dataQualityReport = null;
let telemetryMetrics = null;

// Filter state
const filters = {
  product: 'ALL',
  sentiment: 'ALL',
  topic: 'ALL',
  flag: 'ALL',
  search: ''
};

// DOM Elements
const btnLoadSample = document.getElementById('btnLoadSample');
const btnEmptySample = document.getElementById('btnEmptySample');
const fileInput = document.getElementById('fileInput');
const progressContainer = document.getElementById('progressContainer');
const progressText = document.getElementById('progressText');
const progressPercent = document.getElementById('progressPercent');
const progressBarFill = document.getElementById('progressBarFill');
const statusAlert = document.getElementById('statusAlert');
const dashboardContent = document.getElementById('dashboardContent');
const emptyState = document.getElementById('emptyState');

// KPI Elements
const kpiTotal = document.getElementById('kpiTotal');
const kpiPositive = document.getElementById('kpiPositive');
const kpiPositiveSub = document.getElementById('kpiPositiveSub');
const kpiNeutral = document.getElementById('kpiNeutral');
const kpiNeutralSub = document.getElementById('kpiNeutralSub');
const kpiNegative = document.getElementById('kpiNegative');
const kpiNegativeSub = document.getElementById('kpiNegativeSub');
const kpiNeedsReply = document.getElementById('kpiNeedsReply');
const kpiAgreement = document.getElementById('kpiAgreement');
const kpiMismatchCount = document.getElementById('kpiMismatchCount');

// Data Quality Elements
const dqRowsRead = document.getElementById('dqRowsRead');
const dqAnalysed = document.getElementById('dqAnalysed');
const dqSkipped = document.getElementById('dqSkipped');
const dqDuplicates = document.getElementById('dqDuplicates');
const dqUnknownRatings = document.getElementById('dqUnknownRatings');

// Telemetry Elements
const metricLlmCalls = document.getElementById('metricLlmCalls');
const metricCacheHits = document.getElementById('metricCacheHits');
const metricRetries = document.getElementById('metricRetries');
const metricDuration = document.getElementById('metricDuration');
const metricFailed = document.getElementById('metricFailed');

// Insights
const topPraisesList = document.getElementById('topPraisesList');
const topComplaintsList = document.getElementById('topComplaintsList');

// Filters
const filterProduct = document.getElementById('filterProduct');
const filterSentiment = document.getElementById('filterSentiment');
const filterTopic = document.getElementById('filterTopic');
const filterFlag = document.getElementById('filterFlag');
const filterSearch = document.getElementById('filterSearch');
const btnResetFilters = document.getElementById('btnResetFilters');

// Table & Count
const reviewsTableBody = document.getElementById('reviewsTableBody');
const visibleCount = document.getElementById('visibleCount');
const totalRowCount = document.getElementById('totalRowCount');
const tableTabCount = document.getElementById('tableTabCount');

// Modal Elements
const replyModal = document.getElementById('replyModal');
const modalReviewId = document.getElementById('modalReviewId');
const modalProduct = document.getElementById('modalProduct');
const modalSummary = document.getElementById('modalSummary');
const modalReplyText = document.getElementById('modalReplyText');
const modalReplyMeta = document.getElementById('modalReplyMeta');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalCopyBtn = document.getElementById('modalCopyBtn');
const copyBtnIcon = document.getElementById('copyBtnIcon');

// Product breakdown container
const productCardsGrid = document.getElementById('productCardsGrid');

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  btnLoadSample?.addEventListener('click', loadSampleDataset);
  btnEmptySample?.addEventListener('click', loadSampleDataset);
  fileInput?.addEventListener('change', handleFileUpload);

  filterProduct?.addEventListener('change', (e) => { filters.product = e.target.value; renderTable(); });
  filterSentiment?.addEventListener('change', (e) => { filters.sentiment = e.target.value; renderTable(); });
  filterTopic?.addEventListener('change', (e) => { filters.topic = e.target.value; renderTable(); });
  filterFlag?.addEventListener('change', (e) => { filters.flag = e.target.value; renderTable(); });
  filterSearch?.addEventListener('input', (e) => { filters.search = e.target.value.toLowerCase().trim(); renderTable(); });
  btnResetFilters?.addEventListener('click', resetFilters);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId)?.classList.add('active');
    });
  });

  // Modal close handlers
  modalCloseBtn?.addEventListener('click', closeModal);
  modalCancelBtn?.addEventListener('click', closeModal);
  modalCopyBtn?.addEventListener('click', copySuggestedReply);
  replyModal?.addEventListener('click', (e) => {
    if (e.target === replyModal) closeModal();
  });
});

/**
 * Loads the bundled sample dataset reviews.csv with 1 click.
 */
async function loadSampleDataset() {
  try {
    showAlert('Fetching sample dataset reviews.csv...', 'info');
    const resp = await fetch('/api/sample');
    if (!resp.ok) throw new Error('Failed to load sample dataset');
    const csvBlob = await resp.blob();
    const file = new File([csvBlob], 'reviews.csv', { type: 'text/csv' });
    startAnalysisJob(file);
  } catch (err) {
    showAlert(`Error loading sample: ${err.message}`, 'error');
  }
}

/**
 * Handles user file upload.
 */
function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  startAnalysisJob(file);
}

/**
 * Submits the CSV to /api/jobs and polls for progress.
 */
async function startAnalysisJob(file) {
  const formData = new FormData();
  formData.append('file', file);

  showProgress(true, 'Initializing analysis...', 5);
  hideAlert();

  try {
    const jobResp = await fetch('/api/jobs', {
      method: 'POST',
      body: formData
    });

    if (!jobResp.ok) {
      const errData = await jobResp.json().catch(() => ({}));
      throw new Error(errData.error || `Upload failed with HTTP ${jobResp.status}`);
    }

    const { jobId } = await jobResp.json();
    pollJobProgress(jobId);
  } catch (err) {
    showProgress(false);
    showAlert(`Analysis failed: ${err.message}`, 'error');
  }
}

/**
 * Polls the job endpoint until complete.
 */
function pollJobProgress(jobId) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) throw new Error('Failed to check job progress');
      const job = await res.json();

      if (job.status === 'processing') {
        const { processed = 0, total = 0, currentBatch = 0, totalBatches = 0 } = job.progress || {};
        const pct = total > 0 ? Math.min(95, Math.round((processed / total) * 100)) : 15;
        const msg = totalBatches > 0
          ? `Analyzing reviews with Gemini: ${processed} of ${total} (Batch ${currentBatch}/${totalBatches})...`
          : 'Processing reviews & checking cache...';
        showProgress(true, msg, pct);
      } else if (job.status === 'completed') {
        clearInterval(interval);
        showProgress(true, 'Finalizing insights...', 100);
        setTimeout(() => {
          showProgress(false);
          loadAnalysisResult(job.result);
          showAlert('Review analysis successfully completed!', 'success');
        }, 300);
      } else if (job.status === 'failed') {
        clearInterval(interval);
        showProgress(false);
        showAlert(`Analysis pipeline failed: ${job.error}`, 'error');
      }
    } catch (err) {
      clearInterval(interval);
      showProgress(false);
      showAlert(`Progress polling error: ${err.message}`, 'error');
    }
  }, 400);
}

/**
 * Populates data into dashboard state and triggers view rendering.
 */
function loadAnalysisResult(data) {
  allReviews = data.reviews || [];
  dashboardStats = data.stats || {};
  topInsights = data.topInsights || {};
  dataQualityReport = data.dataQualityReport || {};
  telemetryMetrics = data.metrics || {};

  emptyState.classList.add('hidden');
  dashboardContent.classList.remove('hidden');

  renderKPIs();
  renderDataQuality();
  renderTelemetry();
  renderTopInsights();
  populateProductFilter();
  renderTable();
  renderProductView();
}

/**
 * Renders top metric cards.
 */
function renderKPIs() {
  if (!dashboardStats) return;

  kpiTotal.textContent = dashboardStats.totalAnalysed || 0;
  
  const pct = dashboardStats.sentimentPercent || { positive: 0, neutral: 0, negative: 0 };
  const cnt = dashboardStats.sentimentCounts || { positive: 0, neutral: 0, negative: 0 };

  kpiPositive.textContent = `${pct.positive}%`;
  kpiPositiveSub.textContent = `${cnt.positive} reviews`;

  kpiNeutral.textContent = `${pct.neutral}%`;
  kpiNeutralSub.textContent = `${cnt.neutral} reviews`;

  kpiNegative.textContent = `${pct.negative}%`;
  kpiNegativeSub.textContent = `${cnt.negative} reviews`;

  kpiNeedsReply.textContent = dashboardStats.needsReplyCount || 0;

  const agree = dashboardStats.ratingAgreement || { agreementPercent: 100, mismatchCount: 0 };
  kpiAgreement.textContent = `${agree.agreementPercent}%`;
  kpiMismatchCount.textContent = `${agree.mismatchCount} rating mismatch(es)`;
}

/**
 * Renders Data Quality Panel pills.
 */
function renderDataQuality() {
  if (!dataQualityReport) return;
  dqRowsRead.textContent = dataQualityReport.rowsRead ?? 0;
  dqAnalysed.textContent = dataQualityReport.analysed ?? 0;
  dqSkipped.textContent = dataQualityReport.skippedEmpty ?? 0;
  dqDuplicates.textContent = dataQualityReport.duplicates ?? 0;
  dqUnknownRatings.textContent = dataQualityReport.unknownRatings ?? 0;
}

/**
 * Renders Telemetry (Cost & Speed Log) pills.
 */
function renderTelemetry() {
  if (!telemetryMetrics) return;
  metricLlmCalls.textContent = telemetryMetrics.llmCallsMade ?? 0;
  metricCacheHits.textContent = telemetryMetrics.cachedHits ?? 0;
  metricRetries.textContent = telemetryMetrics.retriesMade ?? 0;
  metricDuration.textContent = `${((telemetryMetrics.durationMs || 0) / 1000).toFixed(2)}s`;
  metricFailed.textContent = telemetryMetrics.failedCount ?? 0;
}

/**
 * Renders Top 3 Praises and Complaints.
 */
function renderTopInsights() {
  topPraisesList.innerHTML = '';
  topComplaintsList.innerHTML = '';

  const praises = topInsights?.praises || [];
  const complaints = topInsights?.complaints || [];

  praises.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    topPraisesList.appendChild(li);
  });

  complaints.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    topComplaintsList.appendChild(li);
  });
}

/**
 * Populates product options in dropdown.
 */
function populateProductFilter() {
  const currentVal = filterProduct.value;
  const products = Array.from(new Set(allReviews.map((r) => r.product).filter(Boolean))).sort();

  filterProduct.innerHTML = '<option value="ALL">All Products</option>';
  products.forEach((prod) => {
    const opt = document.createElement('option');
    opt.value = prod;
    opt.textContent = prod;
    filterProduct.appendChild(opt);
  });

  filterProduct.value = products.includes(currentVal) ? currentVal : 'ALL';
}

/**
 * Filter review items based on current active criteria.
 */
function getFilteredReviews() {
  return allReviews.filter((r) => {
    // Product
    if (filters.product !== 'ALL' && r.product !== filters.product) {
      return false;
    }

    // Sentiment
    if (filters.sentiment !== 'ALL') {
      if (filters.sentiment === 'analysis_failed' && r.status !== 'analysis_failed') return false;
      if (filters.sentiment !== 'analysis_failed' && r.sentiment !== filters.sentiment) return false;
    }

    // Topic
    if (filters.topic !== 'ALL') {
      if (!Array.isArray(r.topics) || !r.topics.includes(filters.topic)) {
        return false;
      }
    }

    // Flags
    if (filters.flag !== 'ALL') {
      if (filters.flag === 'needs_reply' && !r.needs_reply) return false;
      if (filters.flag === 'injection' && !r.possible_injection) return false;
      if (filters.flag === 'mismatch' && !r.rating_mismatch) return false;
      if (filters.flag === 'duplicate' && !r.is_duplicate) return false;
      if (filters.flag === 'failed' && r.status !== 'analysis_failed') return false;
    }

    // Search query
    if (filters.search) {
      const q = filters.search;
      const idMatch = (r.review_id || '').toLowerCase().includes(q);
      const textMatch = (r.text || r.raw_text || '').toLowerCase().includes(q);
      const summaryMatch = (r.summary || '').toLowerCase().includes(q);
      const prodMatch = (r.product || '').toLowerCase().includes(q);
      if (!idMatch && !textMatch && !summaryMatch && !prodMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Renders reviews table.
 */
function renderTable() {
  const filtered = getFilteredReviews();

  visibleCount.textContent = filtered.length;
  totalRowCount.textContent = allReviews.length;
  tableTabCount.textContent = allReviews.length;

  if (filtered.length === 0) {
    reviewsTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center text-muted" style="padding: 30px;">
          No reviews match the selected filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  const rowsHtml = filtered.map((r) => {
    // Rating display
    const ratingDisplay = r.rating !== null && r.rating !== undefined
      ? `<span title="${r.rating} stars">⭐ ${r.rating}</span>`
      : `<span class="badge badge-subtle" title="Raw rating: '${r.raw_rating}'">N/A</span>`;

    // Sentiment badge
    let sentimentBadge = '';
    if (r.status === 'analysis_failed') {
      sentimentBadge = `<span class="badge badge-failed">Failed</span>`;
    } else if (r.status === 'skipped') {
      sentimentBadge = `<span class="badge badge-subtle">Skipped</span>`;
    } else if (r.sentiment === 'positive') {
      sentimentBadge = `<span class="badge badge-positive">Positive</span>`;
    } else if (r.sentiment === 'neutral') {
      sentimentBadge = `<span class="badge badge-neutral">Neutral</span>`;
    } else if (r.sentiment === 'negative') {
      sentimentBadge = `<span class="badge badge-negative">Negative</span>`;
    } else {
      sentimentBadge = `<span class="badge badge-subtle">Unknown</span>`;
    }

    // Topics chips
    const topicsChips = Array.isArray(r.topics) && r.topics.length > 0
      ? `<div class="chips-container">${r.topics.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('')}</div>`
      : '<span class="text-muted">—</span>';

    // Flags
    const flags = [];
    if (r.possible_injection) {
      flags.push(`<span class="badge badge-warning" title="Contains instruction-like phrases (e.g. ignore previous instructions)">⚠️ Possible Injection</span>`);
    }
    if (r.rating_mismatch) {
      flags.push(`<span class="badge badge-purple" title="Rating (${r.rating}★) contradicts AI sentiment (${r.sentiment})">⚡ Rating Mismatch</span>`);
    }
    if (r.is_duplicate) {
      flags.push(`<span class="badge badge-subtle" title="Exact duplicate of ${r.duplicate_of}">🔁 Duplicate (${r.duplicate_of})</span>`);
    }
    if (r.status === 'analysis_failed') {
      flags.push(`<span class="badge badge-failed" title="${escapeHtml(r.failure_reason || '')}">❌ Analysis Failed</span>`);
    }
    if (r.status === 'skipped') {
      flags.push(`<span class="badge badge-subtle">⏩ ${escapeHtml(r.skip_reason || 'Skipped')}</span>`);
    }
    if (r.needs_reply) {
      flags.push(`<span class="badge badge-warning">Needs Reply</span>`);
    }

    const flagsHtml = flags.length > 0
      ? `<div class="flags-container">${flags.join('')}</div>`
      : '<span class="text-muted">—</span>';

    // Action button
    let actionHtml = '<span class="text-muted">—</span>';
    if (r.needs_reply && r.status === 'analysed') {
      actionHtml = `
        <button class="btn btn-sm btn-secondary btn-suggest-reply" data-id="${escapeHtml(r.review_id)}">
          💬 Suggest Reply
        </button>
      `;
    }

    return `
      <tr>
        <td><strong>${escapeHtml(r.review_id)}</strong></td>
        <td>${escapeHtml(r.product)}</td>
        <td>${ratingDisplay}</td>
        <td>${sentimentBadge}</td>
        <td>${topicsChips}</td>
        <td>
          <div><strong>${escapeHtml(r.summary || 'No summary available')}</strong></div>
          <div class="text-customer-quote" title="${escapeHtml(r.raw_text || '')}">
            "${escapeHtml(r.text || r.raw_text || '—')}"
          </div>
        </td>
        <td>${flagsHtml}</td>
        <td>${actionHtml}</td>
      </tr>
    `;
  }).join('');

  reviewsTableBody.innerHTML = rowsHtml;

  // Bind Suggest Reply click listeners
  document.querySelectorAll('.btn-suggest-reply').forEach((btn) => {
    btn.addEventListener('click', () => {
      const reviewId = btn.getAttribute('data-id');
      const review = allReviews.find((r) => r.review_id === reviewId);
      if (review) openSuggestReplyModal(review);
    });
  });
}

/**
 * Renders Tab 2: Product Breakdown Cards (Bonus requirement).
 */
function renderProductView() {
  if (!dashboardStats?.productView) return;

  const cardsHtml = dashboardStats.productView.map((prod) => {
    const topTopicStr = prod.topTopics.slice(0, 3).map((t) => `${t.topic} (${t.count})`).join(', ') || 'None';

    return `
      <div class="product-card">
        <h4>${escapeHtml(prod.product)}</h4>
        <div class="text-muted mb-2" style="font-size: 0.8rem;">${prod.total} reviews total</div>
        <div class="stat-pill-group" style="margin: 10px 0; display: flex; gap: 8px;">
          <span class="badge badge-positive">${prod.positivePercent}% Positive</span>
          <span class="badge badge-negative">${prod.negativePercent}% Negative</span>
          ${prod.needsReply > 0 ? `<span class="badge badge-warning">${prod.needsReply} Need Reply</span>` : ''}
        </div>
        <div style="font-size: 0.825rem; margin-top: 10px;">
          <strong>Top Feedback Topics:</strong> <span class="text-muted">${escapeHtml(topTopicStr)}</span>
        </div>
      </div>
    `;
  }).join('');

  productCardsGrid.innerHTML = cardsHtml;
}

/**
 * Opens Suggested Reply modal and calls /api/reply on click.
 */
async function openSuggestReplyModal(review) {
  modalReviewId.textContent = review.review_id;
  modalProduct.textContent = review.product;
  modalSummary.textContent = review.summary;
  modalReplyText.value = 'Drafting reply with Gemini AI...';
  modalReplyMeta.textContent = '';
  modalCopyBtn.disabled = true;

  replyModal.classList.remove('hidden');

  try {
    const resp = await fetch('/api/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review })
    });

    if (!resp.ok) {
      throw new Error(`Failed to generate reply (HTTP ${resp.status})`);
    }

    const data = await resp.json();
    modalReplyText.value = data.reply || 'No reply generated.';
    modalReplyMeta.textContent = data.isCached ? '⚡ Loaded from local cache' : '✨ Freshly generated by AI';
    modalCopyBtn.disabled = false;
  } catch (err) {
    modalReplyText.value = `Error generating reply: ${err.message}`;
  }
}

/**
 * Copies suggested reply to clipboard.
 */
function copySuggestedReply() {
  const text = modalReplyText.value;
  if (!text) return;

  navigator.clipboard.writeText(text).then(() => {
    copyBtnIcon.textContent = '✅';
    modalCopyBtn.classList.add('btn-secondary');
    modalCopyBtn.classList.remove('btn-primary');
    setTimeout(() => {
      copyBtnIcon.textContent = '📋';
      modalCopyBtn.classList.remove('btn-secondary');
      modalCopyBtn.classList.add('btn-primary');
    }, 2000);
  });
}

function closeModal() {
  replyModal.classList.add('hidden');
}

function resetFilters() {
  filters.product = 'ALL';
  filters.sentiment = 'ALL';
  filters.topic = 'ALL';
  filters.flag = 'ALL';
  filters.search = '';

  filterProduct.value = 'ALL';
  filterSentiment.value = 'ALL';
  filterTopic.value = 'ALL';
  filterFlag.value = 'ALL';
  filterSearch.value = '';

  renderTable();
}

function showProgress(show, message = '', percent = 0) {
  if (show) {
    progressContainer.classList.remove('hidden');
    progressText.textContent = message;
    progressPercent.textContent = `${percent}%`;
    progressBarFill.style.width = `${percent}%`;
  } else {
    progressContainer.classList.add('hidden');
  }
}

function showAlert(message, type = 'info') {
  statusAlert.textContent = message;
  statusAlert.className = `alert alert-${type}`;
  statusAlert.classList.remove('hidden');
}

function hideAlert() {
  statusAlert.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
