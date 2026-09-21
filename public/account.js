import { getSettings, apiPost } from './settings.js';

const account = document.getElementById('accountMenu');
getSettings().then(config => {
  if (!config.user) return;
  account.hidden = false;
  document.getElementById('accountName').textContent = config.user.name || config.user.email;
  account.querySelector('summary').title = config.user.email;
  document.getElementById('accountEmail').textContent = config.user.email;
  document.getElementById('accountRole').textContent = config.development || config.storage === 'development' ? 'Development · Local administrator' : config.user.role === 'admin' ? 'Administrator' : 'Member';
}).catch(() => {});
document.addEventListener('click', event => { if (!account.contains(event.target)) account.open = false; });
account.addEventListener('keydown', event => { if (event.key === 'Escape') { account.open = false; account.querySelector('summary').focus(); } });
document.getElementById('signOut').onclick = async () => {
  const button = document.getElementById('signOut'); button.disabled = true;
  try {
    const response = await apiPost('/api/auth/logout', {});
    if (!response.ok) throw new Error();
    location.replace('/login');
  } catch { button.disabled = false; button.textContent = 'Sign out failed · Retry'; }
};
