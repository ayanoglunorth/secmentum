/* Secmentum candidate sign-in. */
const loginForm     = document.getElementById('loginForm');
const errorMessage  = document.getElementById('errorMessage');
const submitBtn     = document.getElementById('submitBtn');
const accessCode    = document.getElementById('accessCode');

// Auto-uppercase access code
accessCode?.addEventListener('input', () => {
  const pos = accessCode.selectionStart;
  accessCode.value = accessCode.value.toUpperCase();
  accessCode.setSelectionRange(pos, pos);
});

loginForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Hide error, disable button
  errorMessage.classList.add('hidden');
  submitBtn.disabled = true;

  // Show loading state (preserve icon)
  submitBtn.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:8px;">
      <svg style="animation:spin 0.7s linear infinite;width:18px;height:18px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10" /></svg>
      Signing in...
    </span>
  `;

  const formData = new FormData(loginForm);
  const payload  = {
    fullName:   (formData.get('fullName')   || '').toString().trim(),
    email:      (formData.get('email')      || '').toString().trim(),
    accessCode: (formData.get('accessCode') || '').toString().trim().toUpperCase(),
  };

  try {
    const resp = await fetch('/api/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await resp.json();

    if (!resp.ok || !data.success) {
      throw new Error(data.message || 'Sign-in failed');
    }

    window.location.href = data.redirectTo || '/dashboard';
  } catch (err) {
    errorMessage.textContent = err.message || 'Sign-in failed';
    errorMessage.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.innerHTML = `
      Start assessment
      <span class="material-symbols-outlined btn-login-icon">arrow_forward</span>
    `;
  }
});

// Inject spin keyframes
const style = document.createElement('style');
style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(style);
