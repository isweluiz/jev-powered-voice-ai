import { SAMPLE_LOGS } from './demo-data.js';
import { escape } from './ui.js';

export const icons = {
  logs: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  brand: '<path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/>',
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  agents: '<rect x="3" y="6" width="18" height="15" rx="4"/><path d="M12 2v4m-5 6h.01M17 12h.01M8 17h8"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
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

let agentsPromise;
export function loadAgents() {
  return agentsPromise ||= fetch('/api/agents', { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error('Could not load agents. Refresh to try again.');
    return (await response.json()).agents;
  });
}
export function updateShellConnections(config) {
  const count = Object.values(config.configured).filter(Boolean).length;
  document.querySelectorAll('[data-shell-status]').forEach(item => { item.textContent = `${count} of 4 keys configured`; });
  for (const id of ['bandwidth', 'deepgram', 'openai', 'jev']) {
    const item = document.querySelector(`[data-provider="${id}"]`);
    if (!item) continue;
    const browser = id === 'bandwidth' && config.sttProvider === 'browser';
    item.textContent = browser ? 'Browser' : config.configured[id] ? 'Configured' : 'Needs key';
    item.dataset.ready = String(browser || config.configured[id]);
  }
}
export function mountShell({ active = 'home', onSettings = () => {}, config } = {}) {
  document.body.classList.add('has-shell');
  const nav = [['home', '/', 'Overview'], ['mic', '/talk', 'Talk'], ['agents', '/agents', 'My agents'], ['logs', '/logs', 'Conversation logs']];
  const keys = ['home', 'talk', 'agents', 'logs'];
  const title = nav[keys.indexOf(active)]?.[2] || (active === 'templates' ? 'Templates' : 'Agent builder');
  const aside = document.createElement('aside');
  aside.className = 'shell-sidebar'; aside.id = 'workspaceSidebar';
  aside.innerHTML = `<a class="shell-brand" href="/" aria-label="Cayana home"><span class="brand-icon">${icon('brand')}</span><span class="brand-copy"><small>Voice agent workspace</small><strong>Cayana</strong></span></a>
    <p class="nav-caption">Main menu</p><nav aria-label="Main navigation">${nav.map(([glyph, href, label], i) => `<a href="${href}" data-nav="${keys[i]}" ${active === keys[i] ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${keys[i] === 'agents' ? '<small id="navAgentCount"></small>' : keys[i] === 'logs' ? `<small>${SAMPLE_LOGS.length}</small>` : ''}</a>`).join('')}</nav>
    <section class="stack-status" aria-label="Voice stack configuration"><p class="nav-caption">Voice stack</p>${[['bandwidth', 'Speech to text'], ['deepgram', 'Voice (TTS)'], ['openai', 'LLM'], ['jev', 'Jev guidance']].map(([id, label]) => `<div><span>${label}</span><small data-provider="${id}">Checking…</small></div>`).join('')}</section>
    <div class="sidebar-bottom"><button type="button" id="shellSettings">${icon('settings')}<span>Connections & settings</span></button><div id="sidebarGuest" class="guest-card"><span class="profile-avatar">G</span><div><strong>Guest user</strong><small>Local testing</small></div><i aria-hidden="true"></i></div><div id="sidebarAccount"></div></div>`;
  document.body.prepend(aside);
  const scrim = document.createElement('button'); scrim.className = 'nav-scrim'; scrim.tabIndex = -1; scrim.setAttribute('aria-label', 'Close navigation'); document.body.prepend(scrim);
  const header = document.createElement('header'); header.className = 'shell-header';
  header.innerHTML = `<button class="nav-toggle icon-button" type="button" aria-label="Toggle navigation" aria-controls="workspaceSidebar" aria-expanded="false">${icon('grid')}</button><div class="shell-breadcrumb"><a href="/">Cayana</a><span>›</span><strong>${title}</strong></div><button class="shell-search" type="button" aria-label="Search workspace">${icon('search')}<span>Search agents, logs…</span><kbd>⌘K</kbd></button><span class="shell-key-status" data-shell-status>Checking connections…</span>`;
  document.body.insertBefore(header, document.querySelector('body>main,body>.bar'));
  const toggle = header.querySelector('.nav-toggle');
  scrim.onclick = () => { document.body.classList.remove('nav-open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); };
  toggle.onclick = () => { const open = toggle.getAttribute('aria-expanded') !== 'true'; toggle.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('nav-open', open); };
  const account = document.createElement('details'); account.id = 'accountMenu'; account.className = 'account-menu'; account.hidden = true;
  account.innerHTML = `<summary aria-label="Account menu"><span class="profile-avatar">${icon('agents')}</span><span id="accountName">Account</span></summary><div class="menu-items account-details"><span id="accountEmail"></span><small id="accountRole"></small><button type="button" id="signOut">Sign out</button></div>`;
  document.getElementById('sidebarAccount').append(account);
  document.getElementById('shellSettings').onclick = onSettings;
  const dialog = document.createElement('dialog'); dialog.className = 'command-dialog'; dialog.setAttribute('aria-labelledby', 'commandTitle');
  dialog.innerHTML = `<div class="command-heading"><h2 id="commandTitle">Search workspace</h2><button type="button" class="icon-button" aria-label="Close search">×</button></div><input type="search" id="commandInput" aria-label="Search agents and sample logs" placeholder="Agent, caller, or conversation ID…"><div class="command-results"></div>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input'), results = dialog.querySelector('.command-results');
  let owned = [];
  const renderSearch = () => {
    const term = input.value.toLowerCase().trim();
    const entries = [...nav.map(([, href, label]) => ({ href, label, type: 'Page' })), ...owned.map(agent => ({ href: `/talk?agent=${encodeURIComponent(agent.id)}`, label: agent.name, type: 'Agent' })), ...SAMPLE_LOGS.map(log => ({ href: `/logs?id=${encodeURIComponent(log.id)}`, label: `${log.id} · ${log.caller}`, type: 'Sample log' }))].filter(item => item.label.toLowerCase().includes(term));
    results.innerHTML = entries.length ? entries.map(item => `<a href="${item.href}"><span>${escape(item.label)}</span><small>${item.type}</small></a>`).join('') : '<p>No matching agents or logs.</p>';
  };
  header.querySelector('.shell-search').onclick = () => { renderSearch(); dialog.showModal(); input.focus(); };
  dialog.querySelector('button').onclick = () => dialog.close(); input.oninput = renderSearch;
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); renderSearch(); if (!dialog.open) dialog.showModal(); input.focus(); }
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) { document.body.classList.remove('nav-open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
  });
  loadAgents().then(agents => { owned = agents; document.getElementById('navAgentCount').textContent = agents.length; }).catch(() => {});
  if (config) updateShellConnections(config);
}
