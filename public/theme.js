/* Apply the saved scheme before paint and keep all workspace tabs consistent. */
(() => {
  const key = 'cayana-theme';
  function apply(theme) {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      button.querySelector('span').textContent = theme === 'dark' ? 'Light theme' : 'Dark theme';
    });
  }
  let theme = 'light';
  try { theme = localStorage.getItem(key) || theme; } catch {}
  apply(theme);
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem(key, next); } catch {}
  });
  document.addEventListener('DOMContentLoaded', () => apply(document.documentElement.dataset.theme));
  window.addEventListener('storage', event => { if (event.key === key) apply(event.newValue); });
})();
