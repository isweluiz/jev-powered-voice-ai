import { TEMPLATES, CUSTOM_TEMPLATE, getTemplate, buildPrompt } from './templates.js';
import { mountTemplatePicker } from './template-picker.js';
import { icon, mountShell } from './shell.js';
import { getSettings, mountSettings, apiPost } from './settings.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const query = new URLSearchParams(location.search);
const route = location.pathname;
const picking = route === '/agents/new' && !query.has('template') && !query.has('edit');
const page = route === '/agents/new' ? picking ? 'agents' : 'builder' : route === '/agents' ? 'agents' : route === '/templates' ? 'templates' : 'home';
let config, editing, customPrompt = false;
const picker = mountTemplatePicker({ onClose: () => { if (picking) location.replace('/agents'); } });
document.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.dataset.preview || link.getAttribute('href') === '/agents/new') { event.preventDefault(); picker.open(link.dataset.preview); }
});
if (picking) picker.open(query.get('preview'));
const settings = mountSettings({ onChange: updateConnections });
mountShell({ active: page === 'builder' ? 'agents' : page, onSettings: () => settings.open() });
await import('./account.js');
document.querySelectorAll('[data-icon]').forEach(element => element.insertAdjacentHTML('afterbegin', icon(element.dataset.icon)));
$('reviewConnections').onclick = () => settings.open();
const titles = { home: ['YOUR CONVERSATION STUDIO', 'A little clarity goes a long way.'], templates: ['A HEAD START FOR YOUR TEAM', 'A purpose for every conversation.'], agents: ['YOUR AGENT WORKSPACE', 'Built around your business.'], builder: ['CREATE A WEB AGENT', 'Make the conversation your own.'] };
$('pageEyebrow').textContent = titles[page][0]; $('pageTitle').textContent = titles[page][1];
document.title = `Cayana · ${page === 'builder' ? 'Create agent' : page[0].toUpperCase() + page.slice(1)}`;
for (const name of ['home', 'templates', 'agents', 'builder']) $(name + 'View').hidden = name !== page;

function updateConnections(next) {
  config = next;
  const configured = Object.values(next.configured).filter(Boolean).length;
  $('workspaceStatus').textContent = `${configured} of 4 connections ready`;
  $('workspaceStatus').dataset.ready = String(configured === 4);
  $('connectionsSummary').textContent = configured === 4 ? 'All four providers are configured.' : `${configured} of 4 providers configured. Add keys in Connections.`;
}
function card(template) {
  return `<a class="template-card" data-preview="${template.id}" href="/agents/new?preview=${encodeURIComponent(template.id)}" data-accent="${template.accent}"><span class="template-icon">${icon(template.icon)}</span><span class="template-sector">${escape(template.sector)}</span><h3>${escape(template.name)}</h3><p>${escape(template.description)}</p><div class="template-bottom"><span>Preview template</span>${icon('arrow')}</div></a>`;
}
function agentRows(agents) {
  if (!agents.length) return `<div class="empty-state"><span>${icon('agents')}</span><div><h3>Your first agent starts here.</h3><p>Give it a purpose. We’ll help with the next step.</p></div><a class="text-link" href="/agents/new">Create an agent ↗</a></div>`;
  return agents.map(agent => {
    const template = getTemplate(agent.templateId);
    return `<article class="agent-row" data-accent="${template?.accent || 'blue'}"><span class="template-icon">${icon(template?.icon)}</span><div class="agent-row-title"><h3>${escape(agent.name)}</h3><p>${escape(template?.sector || 'Custom agent')}${agent.company ? ' · ' + escape(agent.company) : ''} · Browser voice</p></div><span class="agent-updated">Updated ${escape(new Date(agent.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span><a class="edit-link" href="/agents/new?edit=${encodeURIComponent(agent.id)}" aria-label="Edit ${escape(agent.name)}">Edit</a><a class="button secondary" href="/talk?agent=${encodeURIComponent(agent.id)}" aria-label="Start talking with ${escape(agent.name)}">Start talking ${icon('arrow')}</a></article>`;
  }).join('');
}
async function get(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (response.status === 401) { location.replace('/login?reason=expired'); throw new Error('Please sign in again.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load your workspace.');
  return data;
}
function renderPreview(template) {
  $('previewIcon').innerHTML = icon(template.icon);
  $('previewTitle').textContent = template.name;
  $('previewGoal').textContent = template.description;
  $('previewStageTitle').textContent = template.stageLabel;
  $('previewSignals').innerHTML = template.signals.map(signal => `<span>${escape(signal)}</span>`).join('');
  $('previewStages').innerHTML = template.stages.map(stage => `<li>${escape(stage)}</li>`).join('');
  $('previewActions').innerHTML = template.actions.map(action => `<li>${escape(action.title)}</li>`).join('') + '<li>Involve a person</li>';
}
function updatePrompt() {
  if (!customPrompt) $('agentPrompt').value = buildPrompt(getTemplate($('templateSelect').value), { company: $('companyName').value, goal: $('agentGoal').value, knowledge: $('agentKnowledge').value });
}
function chooseTemplate(template, initial = false) {
  $('templateSelect').value = template.id;
  if (initial || !editing) $('agentName').value = template.name;
  $('agentGoal').value = template.goal;
  customPrompt = false;
  updatePrompt(); renderPreview(template);
}
async function builder() {
  $('templateSelect').replaceChildren(...[...TEMPLATES, CUSTOM_TEMPLATE].map(template => new Option(`${template.sector} · ${template.name}`, template.id)));
  $('agentVoice').replaceChildren(...config.voices.map(voice => new Option(voice.label, voice.id)));
  $('agentVoice').value = config.voice; $('agentSTT').value = config.sttProvider; $('builderModel').value = config.agent.model;
  if (query.get('edit')) {
    editing = (await get('/api/agents/' + encodeURIComponent(query.get('edit')))).agent;
    const fields = { agentName: 'name', companyName: 'company', agentGoal: 'goal', agentKnowledge: 'knowledge', agentPrompt: 'systemPrompt', builderModel: 'model', agentVoice: 'voice', agentSTT: 'sttProvider', templateSelect: 'templateId' };
    for (const [field, key] of Object.entries(fields)) $(field).value = editing[key];
    customPrompt = true; renderPreview(getTemplate(editing.templateId));
    $('pageEyebrow').textContent = 'EDIT WEB AGENT'; $('pageTitle').textContent = editing.name;
  } else {
    const template = getTemplate(query.get('template'));
    if (!template) throw new Error('Template not found. Choose one from Templates.');
    chooseTemplate(template, true);
    if (template.id === 'custom') document.querySelector('.advanced-prompt').open = true;
  }
  $('templateSelect').onchange = () => chooseTemplate(getTemplate($('templateSelect').value));
  for (const field of ['companyName', 'agentGoal', 'agentKnowledge']) $(field).addEventListener('input', updatePrompt);
  $('agentPrompt').oninput = () => { customPrompt = true; };
  $('restorePrompt').onclick = () => { customPrompt = false; updatePrompt(); };
  $('agentForm').onsubmit = async event => {
    event.preventDefault();
    const talk = event.submitter?.value === 'talk';
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    $('saveAgent').disabled = $('saveAndTalk').disabled = true;
    $('saveStatus').textContent = 'Saving your agent…';
    try {
      const response = await apiPost(editing ? '/api/agents/' + encodeURIComponent(editing.id) : '/api/agents', payload);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save this agent.');
      location.assign(talk ? '/talk?agent=' + encodeURIComponent(data.agent.id) : '/agents');
    } catch (error) { $('saveStatus').textContent = error.message; $('saveAgent').disabled = $('saveAndTalk').disabled = false; }
  };
}
try {
  updateConnections(await getSettings());
  if (query.has('settings')) settings.open();
  if (page === 'builder') await builder();
  if (page === 'home' || page === 'agents') {
    const { agents } = await get('/api/agents');
    $('agentCount').textContent = String(agents.length);
    $('recentAgents').innerHTML = agentRows(agents.slice(0, 3));
    $('agentCollection').innerHTML = agentRows(agents);
  }
  $('featuredTemplates').innerHTML = TEMPLATES.slice(0, 4).map(card).join('');
  $('allTemplates').innerHTML = TEMPLATES.map(card).join('');
  const filters = ['All templates', ...TEMPLATES.map(template => template.sector)];
  $('templateFilters').replaceChildren(...filters.map((filter, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = filter; button.setAttribute('aria-pressed', String(index === 0));
    button.onclick = () => { $('templateFilters').querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button))); $('allTemplates').innerHTML = TEMPLATES.filter(template => index === 0 || template.sector === filter).map(card).join(''); };
    return button;
  }));
} catch (error) { $('pageError').hidden = false; $('pageError').textContent = error.message; $('agentForm').querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = true; }); }
