export const icons = {
  brand: '<path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/>',
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  agents: '<rect x="3" y="6" width="18" height="15" rx="4"/><path d="M12 2v4m-5 6h.01M17 12h.01M8 17h8"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  coach: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"/>',
  heart: '<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1s-1 7 8 15C21 12 23 8 20 5Z"/>',
  monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M12 16v5m-5 0h10M8 8l-2 2 2 2m8-4 2 2-2 2"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10v10M3 7l9 5 9-5M8 4l9 5v5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  tool: '<path d="M14 5a6 6 0 0 0-7 8L2 18l4 4 5-5a6 6 0 0 0 8-7l-4 4-5-5Z"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
export const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
export function mountShell({ active = 'home', onSettings = () => {} } = {}) {
  document.body.classList.add('has-shell');
  const nav = [['home', '/', 'Home'], ['mic', '/talk', 'Talk'], ['agents', '/agents', 'My agents'], ['grid', '/templates', 'Templates'], ['coach', '/coach', 'Live coach']];
  const keys = ['home', 'talk', 'agents', 'templates', 'coach'];
  const aside = document.createElement('aside');
  aside.className = 'shell-sidebar'; aside.id = 'workspaceSidebar';
  aside.innerHTML = `<a class="shell-brand" href="/" aria-label="Cayana home"><span>${icon('brand')}</span>Cayana</a>
    <div class="workspace-label"><span class="workspace-avatar">C</span><div>Personal workspace<small id="workspaceKind">Your conversation studio</small></div></div>
    <p class="nav-caption">WORKSPACE</p><nav aria-label="Main navigation">${nav.map(([glyph, href, label], i) => `<a href="${href}" data-nav="${keys[i]}" ${active === keys[i] ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span></a>`).join('')}</nav>
    <div class="sidebar-bottom"><div class="sidebar-note">A clearer conversation.<br><strong>A smarter next step.</strong></div>
    <button type="button" id="shellSettings">${icon('settings')}<span>Connections & settings</span></button><div id="sidebarAccount"></div></div>`;
  document.body.prepend(aside);
  const mobile = document.createElement('div'); mobile.className = 'shell-mobile';
  mobile.innerHTML = `<a href="/">Cayana</a><button type="button" aria-label="Toggle navigation" aria-controls="workspaceSidebar" aria-expanded="false">${icon('grid')}</button>`;
  document.body.prepend(mobile);
  const toggle = mobile.querySelector('button');
  toggle.onclick = () => { const open = toggle.getAttribute('aria-expanded') !== 'true'; toggle.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('nav-open', open); };
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('nav-open')) { document.body.classList.remove('nav-open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); } });
  let account = document.getElementById('accountMenu');
  if (!account) {
    account = document.createElement('details'); account.id = 'accountMenu'; account.className = 'account-menu'; account.hidden = true;
    account.innerHTML = `<summary aria-label="Account menu"><span class="profile-avatar">${icon('agents')}</span><span id="accountName">Account</span></summary><div class="menu-items account-details"><span id="accountEmail"></span><small id="accountRole"></small><button type="button" id="signOut">Sign out</button></div>`;
  }
  document.getElementById('sidebarAccount').append(account);
  document.getElementById('shellSettings').onclick = onSettings;
  return { setActive(value) { aside.querySelectorAll('[data-nav]').forEach(link => { if (link.dataset.nav === value) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }); } };
}
