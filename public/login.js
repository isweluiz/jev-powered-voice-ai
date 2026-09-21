const button = document.getElementById('googleSignIn');
const status = document.getElementById('loginStatus');
const messages = {
  setup: 'Google sign-in is being set up. Please try again soon.',
  expired: 'Your sign-in session expired. Please sign in again.',
  cancelled: 'Sign-in was cancelled. You can try again whenever you’re ready.',
  denied: 'This Google account does not have access to this workspace.',
  failed: 'We couldn’t complete sign-in. Please try again.',
};
button.onclick = () => { button.disabled = true; status.textContent = 'Taking you to Google…'; location.assign('/api/auth/google'); };
(async () => {
  try {
    const response = await fetch('/api/auth/status', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const config = await response.json();
    if (config.user || !config.enabled) { location.replace('/'); return; }
    const reason = new URLSearchParams(location.search).get('reason');
    button.disabled = !config.configured;
    status.textContent = !config.configured ? messages.setup : messages[reason] || '';
    status.dataset.error = String(config.configured && Boolean(messages[reason]));
  } catch { status.textContent = 'Sign-in is temporarily unavailable. Please refresh to try again.'; status.dataset.error = 'true'; }
})();
