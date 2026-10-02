/* Secmentum candidate assessment flow. */

import { useVideoRecorder } from './hooks/useVideoRecorder.js';


// ── DOM References ─────────────────────────────────────────────

const stageLabel = document.getElementById('stageLabel');
const stageName = document.getElementById('stageName');
const currentQEl = document.getElementById('currentQ');
const timerDisplay = document.getElementById('timerDisplay');
const userNameEl = document.getElementById('userName');

// Sidebar
const cameraPreviewSidebar = document.getElementById('cameraPreviewSidebar');
const previewVideoSidebar = document.getElementById('previewVideoSidebar');
const audioLevelSidebar = document.getElementById('audioLevelSidebar');
const sidebarTimer = document.getElementById('sidebarTimer');

// Question
const questionContainer = document.getElementById('questionContainer');
const pageIndicators = document.getElementById('pageIndicators');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

// Modals
const cameraModal = document.getElementById('cameraModal');
const cancelCameraBtn = document.getElementById('cancelCameraBtn');
const allowCameraBtn = document.getElementById('allowCameraBtn');

const fullscreenRequiredOverlay = document.getElementById('fullscreenRequiredOverlay');
const enterFullscreenBtn = document.getElementById('enterFullscreenBtn');
const cancelFullscreenBtn = document.getElementById('cancelFullscreenBtn');

const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNumber = document.getElementById('countdownNumber');
const countdownRing = document.getElementById('countdownRing');

const fullscreenWarningModal = document.getElementById('fullscreenWarningModal');
const reenterFullscreenButton = document.getElementById('reenterFullscreenButton');

const tabWarningModal = document.getElementById('tabWarningModal');
const tabWarningText = document.getElementById('tabWarningText');
const tabWarningAcknowledgeButton = document.getElementById('tabWarningAcknowledgeButton');

const uploadOverlay = document.getElementById('uploadOverlay');
const uploadStatusText = document.getElementById('uploadStatusText');

const blocker = document.getElementById('blocker');
const blockerReason = document.getElementById('blockerReason');

// ── State ──────────────────────────────────────────────────────

const recorder = useVideoRecorder({ timeslice: 5000 });

let currentStageId = null;
let currentStage = null;
let secondsRemaining = 0;
let timerId = null;
let isTestStarted = false;
let isUploading = false;
let isPausedByFullscreenViolation = false;
let tabViolationCounter = 0;
let tabSwitchedWhileHidden = false;
let allowPageLeave = false;
let storageEnabled = false;
let currentQuestionIndex = 0;
let stageQuestions = [];
let selectedAnswers = {};
let questionLockTimer = null;

// ── Utilities ──────────────────────────────────────────────────

function getStageIdFromPath() {
  const parts = window.location.pathname.split('/');
  return Number(parts[parts.length - 1]);
}

function formatTime(total) {
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function showEl(el) { el && el.classList.remove('hidden'); }
function hideEl(el) { el && el.classList.add('hidden'); }

function updateTimerUI() {
  const t = Math.max(0, secondsRemaining);
  if (timerDisplay) timerDisplay.textContent = `Remaining: ${formatTime(t)}`;
  if (sidebarTimer) sidebarTimer.textContent = formatTime(t);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForOnlineConnection() {
  if (navigator.onLine) return Promise.resolve();
  if (uploadStatusText) uploadStatusText.textContent = 'Connection lost. Waiting to reconnect...';
  return new Promise(resolve => {
    const handler = () => { window.removeEventListener('online', handler); resolve(); };
    window.addEventListener('online', handler);
  });
}

// ── Countdown Timer ────────────────────────────────────────────

function startCountdown() {
  clearInterval(timerId);
  timerId = setInterval(() => {
    if (!isTestStarted || isUploading || isPausedByFullscreenViolation) return;
    secondsRemaining -= 1;
    updateTimerUI();
    if (secondsRemaining <= 0) {
      finishTest('time-up').catch(err => console.error(err));
    }
  }, 1000);
}

// ── Fullscreen ─────────────────────────────────────────────────

async function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) return;
  if (!el.requestFullscreen) throw new Error('Fullscreen is not supported by this browser');
  await el.requestFullscreen();
}

// ── Render Questions ───────────────────────────────────────────

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function setQuestionLock(locked) {
  const inputs = questionContainer.querySelectorAll('input');
  inputs.forEach(inp => inp.disabled = locked);

  if (pageIndicators) {
    const dots = pageIndicators.querySelectorAll('.page-dot');
    dots.forEach(dot => dot.disabled = locked);
  }

  const atFirst = currentQuestionIndex === 0;
  if (prevBtn) prevBtn.disabled = locked || atFirst;
  if (nextBtn) nextBtn.disabled = locked;

  const optionsDiv = questionContainer.querySelector('.question-options');
  if (optionsDiv) {
    optionsDiv.style.opacity = locked ? '0.5' : '1';
    optionsDiv.style.pointerEvents = locked ? 'none' : 'auto';
  }
}

function renderCurrentQuestion() {
  if (!stageQuestions.length) {
    questionContainer.innerHTML = '<p style="color:#ba1a1a;font-size:14px;">No questions are configured for this stage.</p>';
    return;
  }

  const question = stageQuestions[currentQuestionIndex];
  const options = question.options || [];
  const selectedAnswer = selectedAnswers[question.id];
  const isOpenText = options.length === 0;

  // Current question number
  if (currentQEl) currentQEl.textContent = String(currentQuestionIndex + 1);

  let optionsHtml = '';

  if (isOpenText) {
    optionsHtml = `
      <div class="open-text-wrap">
        <label class="open-text-label" for="openTextAnswer">Your answer</label>
        <input
          id="openTextAnswer"
          name="questionTextAnswer"
          type="text"
          class="open-text-input"
          value="${typeof selectedAnswer === 'string' ? escapeHtml(selectedAnswer) : ''}"
          autocomplete="off"
        />
      </div>
    `;
  } else {
    optionsHtml = options.map((opt, idx) => {
      const letter = OPTION_LETTERS[idx] || String(idx + 1);
      const isChosen = selectedAnswer === idx;
      return `
        <label class="option-label${isChosen ? ' option-selected' : ''}" data-index="${idx}">
          <input type="radio" name="questionOption" value="${idx}" ${isChosen ? 'checked' : ''} style="position:absolute;opacity:0;width:0;height:0" />
          <span class="option-radio"></span>
          <span class="option-letter">${letter})</span>
          <span class="option-text">${escapeHtml(opt)}</span>
        </label>
      `;
    }).join('');
  }

  questionContainer.innerHTML = `
    <p class="question-text">Question ${currentQuestionIndex + 1}: ${escapeHtml(question.text)}</p>
    <div class="question-options">${optionsHtml}</div>
  `;

  renderDots();
  updateNavButtons();

  if (questionLockTimer) clearTimeout(questionLockTimer);
  setQuestionLock(true);
  questionLockTimer = setTimeout(() => {
    setQuestionLock(false);
  }, 3000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDots() {
  if (!pageIndicators) return;
  const total = stageQuestions.length;
  pageIndicators.innerHTML = stageQuestions.map((q, i) => {
    const isCurrent = i === currentQuestionIndex;
    const isAnswered = selectedAnswers[q.id] !== undefined;
    let cls = 'page-dot';
    if (isCurrent && isAnswered) cls += ' page-dot--answered-current';
    else if (isCurrent) cls += ' page-dot--current';
    else if (isAnswered) cls += ' page-dot--answered';
    return `<button class="${cls}" data-idx="${i}" aria-label="Question ${i + 1}"></button>`;
  }).join('');

  // Dot click navigation
  pageIndicators.querySelectorAll('.page-dot').forEach(btn => {
    btn.addEventListener('click', () => {
      currentQuestionIndex = Number(btn.dataset.idx);
      renderCurrentQuestion();
    });
  });
}

function updateNavButtons() {
  const total = stageQuestions.length;
  const atFirst = currentQuestionIndex === 0;
  const atLast = currentQuestionIndex === total - 1;

  if (prevBtn) prevBtn.disabled = atFirst;

  if (nextBtn) {
    if (atLast) {
      nextBtn.textContent = 'Submit';
    } else {
      nextBtn.textContent = 'Next';
    }
  }
}

// ── Answer Handling ────────────────────────────────────────────

questionContainer?.addEventListener('change', e => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.name !== 'questionOption') return;
  const q = stageQuestions[currentQuestionIndex];
  selectedAnswers[q.id] = Number(t.value);

  // Update label classes without re-rendering
  questionContainer.querySelectorAll('.option-label').forEach((lbl, idx) => {
    lbl.classList.toggle('option-selected', idx === Number(t.value));
    const radio = lbl.querySelector('.option-radio');
    if (radio) {
      radio.style.borderColor = idx === Number(t.value) ? 'var(--primary)' : '';
      radio.style.background = idx === Number(t.value) ? 'var(--primary)' : '';
    }
  });

  renderDots();
});

questionContainer?.addEventListener('input', e => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.name !== 'questionTextAnswer') return;
  const q = stageQuestions[currentQuestionIndex];
  const text = t.value.trim();
  if (text) selectedAnswers[q.id] = text;
  else delete selectedAnswers[q.id];
  renderDots();
});

// ── Navigation Buttons ─────────────────────────────────────────

prevBtn?.addEventListener('click', () => {
  if (currentQuestionIndex > 0) {
    currentQuestionIndex--;
    renderCurrentQuestion();
  }
});

nextBtn?.addEventListener('click', () => {
  const atLast = currentQuestionIndex === stageQuestions.length - 1;
  if (atLast) {
    // Submit
    finishTest('candidate-submit').catch(err => console.error(err));
  } else {
    currentQuestionIndex++;
    renderCurrentQuestion();
  }
});

// ── Stage Start Flow ───────────────────────────────────────────
// Camera consent happens on the dashboard before this page opens.

async function startStageAndShowFullscreen() {
  try {
    // Start the stage before entering fullscreen.
    const startResp = await fetch('/api/stage/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: currentStageId }),
    });
    const startData = await startResp.json();
    if (!startResp.ok || !startData.success) {
      throw new Error(startData.message || 'Stage could not be started');
    }

    // Request fullscreen through a user action.
    showEl(fullscreenRequiredOverlay);

  } catch (err) {
    alert(err.message || 'Assessment could not start. Returning to the dashboard.');
    window.location.href = '/dashboard';
  }
}

/**
 * Start from the fullscreen confirmation button.
 *   → Enter fullscreen
 *   → Show 3-second countdown
 *   → Start recording
 *   → Begin test
 */
enterFullscreenBtn?.addEventListener('click', async () => {
  try {
    await enterFullscreen();
  } catch (e) {
    // Fullscreen might fail in some browsers; proceed anyway
  }

  hideEl(fullscreenRequiredOverlay);
  await runCountdown(3);

  // Reopen the previously approved media stream.
  await recorder.requestPermissions();
  if (previewVideoSidebar) {
    recorder.attachPreview(previewVideoSidebar);
  }

  // Start recording
  const sessionId = `stage-${currentStageId}-${Date.now()}`;
  await recorder.startRecording(sessionId);


  // Show camera sidebar
  showEl(cameraPreviewSidebar);
  if (sidebarTimer) showEl(sidebarTimer);

  isTestStarted = true;

  // Start audio level visualization
  startAudioLevel();

  hideEl(countdownOverlay);

  // Reveal questions after the countdown.
  const testMain = document.getElementById('testMain');
  showEl(testMain);

  startCountdown();
});

cancelFullscreenBtn?.addEventListener('click', () => {
  hideEl(fullscreenRequiredOverlay);
  window.location.href = '/dashboard';
});

/**
 * Countdown animation: 3 → 2 → 1 → 0
 */
function runCountdown(seconds) {
  return new Promise(resolve => {
    showEl(countdownOverlay);

    const circumference = 2 * Math.PI * 44; // r=44 → 276.46
    let remaining = seconds;

    function tick() {
      if (countdownNumber) countdownNumber.textContent = String(remaining);

      // Ring offset: full circle = 0, empty = circumference
      const offset = circumference * (1 - remaining / seconds);
      if (countdownRing) countdownRing.style.strokeDashoffset = String(offset);

      if (remaining <= 0) {
        resolve();
        return;
      }

      remaining--;
      setTimeout(tick, 1000);
    }

    tick();
  });
}

/**
 * Audio level visualizer
 */
function startAudioLevel() {
  try {
    const stream = recorder.getStream?.();
    if (!stream) return;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const anal = ctx.createAnalyser();
    anal.fftSize = 256;
    src.connect(anal);
    const data = new Uint8Array(anal.frequencyBinCount);

    function loop() {
      if (!isTestStarted) return;
      anal.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const pct = Math.min(100, avg * 2);
      if (audioLevelSidebar) audioLevelSidebar.style.width = `${pct}%`;
      requestAnimationFrame(loop);
    }
    loop();
  } catch (e) { console.error('AudioLevel Error:', e); }
}

// ── Fullscreen Events ──────────────────────────────────────────

document.addEventListener('fullscreenchange', () => {
  if (!isTestStarted || isUploading) return;

  if (!document.fullscreenElement) {
    isPausedByFullscreenViolation = true;
    showEl(fullscreenWarningModal);
    return;
  }

  if (isPausedByFullscreenViolation) {
    isPausedByFullscreenViolation = false;
    hideEl(fullscreenWarningModal);
  }
});

reenterFullscreenButton?.addEventListener('click', async () => {
  try { await enterFullscreen(); } catch (_) { }
});

// ── Tab Visibility Events ──────────────────────────────────────

document.addEventListener('visibilitychange', () => {
  if (!isTestStarted || isUploading) return;

  if (document.hidden) {
    tabSwitchedWhileHidden = true;
    tabViolationCounter++;
    return;
  }

  if (tabSwitchedWhileHidden) {
    if (tabWarningText) {
      tabWarningText.textContent = `Keep this tab active. Tab changes detected: ${tabViolationCounter}.`;
    }
    showEl(tabWarningModal);
    tabSwitchedWhileHidden = false;
  }
});

tabWarningAcknowledgeButton?.addEventListener('click', () => hideEl(tabWarningModal));

// ── Before Unload ──────────────────────────────────────────────

window.addEventListener('beforeunload', e => {
  if (allowPageLeave) return;
  if (isTestStarted || isUploading) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ── Answer Sheet Builder ───────────────────────────────────────

function buildAnswerSheetText({ durationMs, reason }) {
  const header = [
    'Secmentum Assessment Answer Report',
    `Stage: ${currentStageId}`,
    `Stage title: ${currentStage?.title || 'Unknown'}`,
    `Completion reason: ${reason}`,
    `Duration (ms): ${durationMs}`,
    `Created at: ${new Date().toISOString()}`,
    '',
  ];

  const lines = stageQuestions.flatMap((q, i) => {
    const sel = selectedAnswers[q.id];
    const isIdx = Number.isInteger(sel);
    const isText = typeof sel === 'string' && sel.trim().length > 0;
    const answerText = isIdx ? (q.options[sel] || 'Not answered')
      : isText ? sel.trim()
        : 'Not answered';
    const rows = [
      `${i + 1}. Question ID: ${q.id}`,
      `Question: ${q.text}`,
      `Selected answer: ${answerText}`,
    ];
    if (q.options.length) {
      rows.push('Options:');
      q.options.forEach((o, oi) => rows.push(`  ${sel === oi ? '*' : '-'} ${oi + 1}) ${o}`));
    }
    rows.push('');
    return rows;
  });

  return [...header, ...lines].join('\n');
}

// ── API Calls ──────────────────────────────────────────────────

async function uploadAnswerSheet({ durationMs, reason }) {
  const content = buildAnswerSheetText({ durationMs, reason });
  const resp = await fetch('/api/upload-answers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage: currentStageId, durationMs, reason, content }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.success) throw new Error(data.message || 'Answer report upload failed');
}

async function completeStageOnServer(durationMs) {
  const resp = await fetch('/api/stage/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stage: currentStageId,
      durationMs,
      score: Object.keys(selectedAnswers).length,
    }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.success) throw new Error(data.message || 'Stage could not be completed');
  return data;
}

// ── Finish Test ────────────────────────────────────────────────

async function finishTest(reason) {
  if (!isTestStarted || isUploading) return;

  isUploading = true;
  isTestStarted = false;
  clearInterval(timerId);

  showEl(uploadOverlay);
  if (uploadStatusText) uploadStatusText.textContent = 'Finalizing the local recording...';

  const recordingInfo = await recorder.stopRecording();
  const durationMs = recordingInfo.durationMs;

  let videoUploaded = !storageEnabled;
  let attempt = 0;
  while (!videoUploaded) {
    attempt++;
    try {
      await waitForOnlineConnection();
      if (uploadStatusText) uploadStatusText.textContent = `Uploading recording (attempt ${attempt})...`;
      await recorder.uploadMergedRecording({ uploadUrl: '/api/upload', stage: currentStageId, durationMs });
      videoUploaded = true;
    } catch (err) {
      if (uploadStatusText) uploadStatusText.textContent = `Upload failed: ${err.message}. Retrying...`;
      await sleep(5000);
    }
  }

  let answersUploaded = !storageEnabled;
  let answersAttempt = 0;
  while (!answersUploaded) {
    answersAttempt++;
    try {
      await waitForOnlineConnection();
      if (uploadStatusText) uploadStatusText.textContent = `Uploading answers (attempt ${answersAttempt})...`;
      await uploadAnswerSheet({ durationMs, reason });
      answersUploaded = true;
    } catch (err) {
      if (uploadStatusText) uploadStatusText.textContent = `Answer upload failed: ${err.message}. Retrying...`;
      await sleep(5000);
    }
  }

  if (uploadStatusText) uploadStatusText.textContent = storageEnabled ? 'Upload complete. Saving stage result...' : 'Demo mode: recording discarded. Saving stage result...';
  const completionData = await completeStageOnServer(durationMs);

  const isAssessmentCompleted = Array.isArray(completionData?.stages)
    ? completionData.stages.every(s => s.status === 'Completed')
    : false;

  await recorder.clearCurrentSession();
  recorder.destroy();

  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => { });
  }

  const path = isAssessmentCompleted ? '/assessment-completed' : '/dashboard';
  if (uploadStatusText) uploadStatusText.textContent = isAssessmentCompleted ? 'Complete. Opening the summary...' : 'Complete. Returning to the dashboard...';

  allowPageLeave = true;
  isUploading = false;
  setTimeout(() => { window.location.href = path; }, 1200);
}

// ── Init ───────────────────────────────────────────────────────

async function initializePage() {
  currentStageId = getStageIdFromPath();

  const dashResp = await fetch('/api/dashboard');
  if (dashResp.status === 401) { window.location.href = '/login'; return; }

  const dashData = await dashResp.json();
  storageEnabled = Boolean(dashData.storageEnabled);

  // Show username
  if (userNameEl && dashData.user) {
    userNameEl.textContent = dashData.user.fullName || dashData.user.email || '';
  }

  currentStage = (dashData.stages || []).find(s => s.id === currentStageId);

  if (!currentStage || currentStage.status !== 'Pending') {
    window.location.href = '/dashboard';
    return;
  }

  // Set header labels
  const stageNum = String(currentStage.id).padStart(2, '0');
  if (stageLabel) stageLabel.textContent = `STAGE ${stageNum}`;
  if (stageName) stageName.textContent = currentStage.title;

  // Set timer
  secondsRemaining = currentStage.durationMinutes * 60;
  updateTimerUI();

  const questionsResponse = await fetch(`/api/stages/${currentStage.id}/questions`);
  if (!questionsResponse.ok) throw new Error('Questions could not be loaded');
  const questionsData = await questionsResponse.json();
  stageQuestions = [...questionsData.questions].sort((a, b) => a.id - b.id);
  selectedAnswers = {};
  currentQuestionIndex = 0;

  renderCurrentQuestion();

  // Begin the stage and fullscreen flow.
  await startStageAndShowFullscreen();
}

initializePage().catch(() => {
  window.location.href = '/dashboard';
});
