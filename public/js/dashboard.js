/* Secmentum assessment dashboard and recording consent flow. */

// ── Helpers ────────────────────────────────────────────────────

const STAGE_ICONS = {
  1: 'psychology',
  2: 'translate',
  3: 'insights',
};

const STATUS_LABEL = {
  Locked:    'LOCKED',
  Pending:   'READY',
  Completed: 'COMPLETED',
};

// ── State ──────────────────────────────────────────────────────

let pendingStageId = null;

// ── DOM ────────────────────────────────────────────────────────

const cameraModal    = document.getElementById('cameraModal');
const cancelCameraBtn = document.getElementById('cancelCameraBtn');
const allowCameraBtn  = document.getElementById('allowCameraBtn');

// ── Camera Modal ───────────────────────────────────────────────

function showCameraModal(stageId) {
  pendingStageId = stageId;
  cameraModal?.classList.remove('hidden');
}

function hideCameraModal() {
  cameraModal?.classList.add('hidden');
  pendingStageId = null;
  if (allowCameraBtn) {
    allowCameraBtn.disabled = false;
    allowCameraBtn.textContent = 'I CONSENT — CONTINUE';
  }
}

cancelCameraBtn?.addEventListener('click', () => {
  hideCameraModal();
});

allowCameraBtn?.addEventListener('click', async () => {
  if (!pendingStageId) return;

  allowCameraBtn.disabled = true;
  allowCameraBtn.textContent = 'Requesting access...';

  try {
    // Trigger the browser permission dialog after explicit consent.
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    // The assessment page reopens the stream.
    stream.getTracks().forEach(t => t.stop());

    allowCameraBtn.textContent = 'Opening stage...';

    // Continue to the selected stage.
    window.location.href = `/test/${pendingStageId}?cam=granted`;

  } catch (err) {
    allowCameraBtn.disabled = false;
    allowCameraBtn.textContent = 'I CONSENT — CONTINUE';
    const msg = err.name === 'NotAllowedError'
      ? 'Camera or microphone access was denied. Update your browser permissions to continue.'
      : (err.message || 'Camera access is unavailable.');
    alert(msg);
  }
});

// ── Stage Card Builder ─────────────────────────────────────────

function buildStageCard(stage) {
  const isPending   = stage.status === 'Pending';
  const isCompleted = stage.status === 'Completed';
  const isLocked    = stage.status === 'Locked';

  const icon  = STAGE_ICONS[stage.id] || 'quiz';
  const label = STATUS_LABEL[stage.status] || 'LOCKED';
  const stageNum = String(stage.id).padStart(2, '0');

  const iconBlockClass = (isLocked || isCompleted) ? 'stage-icon-block--locked' : '';
  const statusClass    = isPending ? '' : (isCompleted ? 'stage-status-label--completed' : 'stage-status-label--locked');
  const dotClass       = isPending ? '' : 'stage-dot--locked';
  const titleClass     = isLocked ? 'stage-title--locked' : '';
  const cardClass      = (isLocked || isCompleted) ? 'stage-locked' : '';

  let actionHtml = '';
  if (isPending) {
    // A single delegated click handler starts stages.
    actionHtml = `
      <button class="btn-start-stage" data-stage-id="${stage.id}" id="startStageBtn-${stage.id}">START</button>
    `;
  } else if (isCompleted) {
    actionHtml = `
      <button class="btn-completed-stage" disabled>
        <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">check_circle</span>
        COMPLETED
      </button>
    `;
  } else {
    actionHtml = `
      <button class="btn-locked-stage" disabled>
        <span class="material-symbols-outlined">lock</span>
        LOCKED
      </button>
    `;
  }

  return `
    <div class="stage-card ${cardClass}">
      <div class="stage-card-inner">
        <div class="stage-icon-block ${iconBlockClass}">
          <span class="material-symbols-outlined">${icon}</span>
        </div>
        <div class="stage-info">
          <div class="stage-badge-row">
            <span class="stage-number">STAGE ${stageNum}</span>
            <span class="stage-dot ${dotClass}"></span>
            <span class="stage-status-label ${statusClass}">${label}</span>
          </div>
          <h3 class="stage-title ${titleClass}">${stage.id}. ${stage.title}</h3>
          <div class="stage-meta">
            <span class="stage-meta-item">
              <span class="material-symbols-outlined">schedule</span>
              ${stage.durationMinutes} min
            </span>
            <span class="stage-meta-item">
              <span class="material-symbols-outlined">quiz</span>
              ${stage.questions} questions
            </span>
          </div>
        </div>
        <div class="stage-action">
          ${actionHtml}
        </div>
      </div>
    </div>
  `;
}

// ── Stage Start Click Delegation ───────────────────────────────

document.getElementById('stagesContainer')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-stage-id]');
  if (!btn) return;
  const stageId = Number(btn.dataset.stageId);
  if (!stageId) return;
  showCameraModal(stageId);
});

// ── Load Dashboard ─────────────────────────────────────────────

async function loadDashboard() {
  const response = await fetch('/api/dashboard');

  if (response.status === 401) {
    window.location.href = '/login';
    return;
  }

  const data = await response.json();

  const userNameEl = document.getElementById('userName');
  if (userNameEl && data.user) {
    userNameEl.textContent = data.user.fullName || data.user.email || '';
  }

  const stages    = data.stages || [];
  const completed = stages.filter(s => s.status === 'Completed').length;
  const total     = stages.length;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;

  const progressBar  = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  if (progressBar)  progressBar.style.width = `${pct}%`;
  if (progressText) progressText.textContent = `%${pct}`;

  const container = document.getElementById('stagesContainer');
  if (container) {
    container.innerHTML = stages.map(buildStageCard).join('');
  }
}

loadDashboard().catch(() => {
  const container = document.getElementById('stagesContainer');
  if (container) {
    container.innerHTML = '<p style="color:#ba1a1a;font-size:14px;">Dashboard data could not be loaded.</p>';
  }
});
