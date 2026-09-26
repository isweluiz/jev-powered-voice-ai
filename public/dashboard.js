import { SAMPLE_AGENTS, SAMPLE_LOGS, summarizeLogs, selectLogs, formatDuration } from './demo-data.js';
import { getTemplate } from './templates.js';
import { icon } from './shell.js';
import { escape, outcomePill } from './ui.js';

const $ = id => document.getElementById(id);
const agentName = id => SAMPLE_AGENTS.find(agent => agent.id === id)?.name || getTemplate(id)?.name || 'Agent';
const talkLink = (agents, templateId) => {
  const agent = agents.find(item => item.templateId === templateId);
  return agent ? `/talk?agent=${encodeURIComponent(agent.id)}` : '/agents';
};
export function agentCard(agent, { compact = false } = {}) {
  const template = getTemplate(agent.templateId);
  const logs = SAMPLE_LOGS.filter(log => log.agent === agent.templateId);
  const stats = summarizeLogs(logs);
  return `<article class="${compact ? 'quick-agent' : 'agent-card'}"><div class="agent-card-heading"><span class="template-icon">${icon(template?.icon || 'agents')}</span><div><span class="template-sector">${escape(template?.sector || 'Custom')}</span><h3>${escape(agent.name)}</h3></div></div><p>${escape(template?.description || 'A voice agent with your instructions and a clear next step.')}</p>${compact ? '' : `<div class="stage-chips">${(template?.stages || []).map(stage => `<span>${escape(stage)}</span>`).join('')}</div><div class="agent-card-stats"><div><small>Sample sessions</small><strong>${stats.total}</strong></div><div><small>Resolved / qualified</small><strong>${stats.total ? stats.rate + '%' : '—'}</strong></div><div><small>Avg. time</small><strong>${stats.total ? formatDuration(stats.average) : '—'}</strong></div></div>`}<div class="agent-card-actions">${compact ? '' : `<a class="text-link" aria-label="Edit ${escape(agent.name)}" href="/agents/new?edit=${encodeURIComponent(agent.id)}">Edit agent</a>`}<a class="button ${compact ? 'secondary' : 'primary'}" href="/talk?agent=${encodeURIComponent(agent.id)}" aria-label="Start talking with ${escape(agent.name)}">${compact ? 'Talk to agent' : 'Start talking'} ${icon('arrow')}</a></div></article>`;
}

function renderChart(period) {
  const labels = { weekly: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], monthly: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], yearly: ['2022', '2023', '2024', '2025', '2026'] }[period];
  const per = period === 'weekly' ? 6 : period === 'yearly' ? 9 : 4;
  const columns = Array.from({ length: labels.length * per }, (_, i) => {
    const voice = Math.max(1, Math.round(8 + Math.sin(i * .3) * 5 + Math.cos(i * 1.7) * 3));
    return { voice, text: 2 + i % 5, label: labels[Math.floor(i / per)] };
  });
  $('trendTotal').textContent = columns.reduce((sum, col) => sum + (col.voice + col.text) * 9, 0).toLocaleString();
  $('heatChart').style.setProperty('--chart-cols', columns.length);
  $('heatChart').innerHTML = columns.map(col => `<button type="button" class="heat-column" aria-label="${col.label}: ${col.voice * 9} voice and ${col.text * 9} text sample sessions">${Array.from({ length: 22 }, (_, row) => `<i class="${21 - row < col.voice ? 'heat-voice' : 21 - row < col.voice + col.text ? 'heat-text' : ''}"></i>`).join('')}<span class="chart-tooltip">${col.label}<b>${col.voice * 9} voice · ${col.text * 9} text</b></span></button>`).join('');
  $('chartLabels').innerHTML = labels.map(label => `<span>${label}</span>`).join('');
}
export function mountOverview(agents) {
  const stats = summarizeLogs(SAMPLE_LOGS);
  const metrics = [['Conversations', stats.total, 'sessions', 'Eight supplied example logs'], ['Avg. handle time', formatDuration(stats.average), '', 'Average across sample logs'], ['Resolution rate', stats.rate + '%', '', 'Resolved or qualified examples'], ['Human handoffs', stats.handoffs, 'sessions', 'Handed off or escalated examples']];
  $('metricCards').innerHTML = metrics.map(([label, value, unit, note], k) => `<article class="metric-card"><div class="metric-inner"><div><h2>${label}</h2><div class="metric-value">${value}<small>${unit}</small></div></div><div class="spark-bars" aria-hidden="true">${SAMPLE_LOGS.map((log, i) => `<i style="height:${12 + log.score / 3}px" class="${i === k + 2 ? 'accent' : ''}"></i>`).join('')}</div></div><p>${note}<span>Sample</span></p></article>`).join('');
  const picks = ['sales', 'service', 'it-support', 'logistics'].map(id => agents.find(agent => agent.templateId === id)).filter(Boolean);
  $('quickAgents').innerHTML = picks.map(agent => agentCard(agent, { compact: true })).join('');
  $('outcomeValue').innerHTML = `<strong>${stats.resolved}</strong><span>of ${stats.total} sample sessions</span>`;
  $('sampleInsight').textContent = `${stats.resolved} of ${stats.total} examples end resolved or qualified. Two need human attention. Clear intent and a focused next question help the agent progress; external actions still require a connected service.`;
  $('outcomeBars').innerHTML = SAMPLE_LOGS.map(log => `<div><i style="height:${log.score}%"></i><span>${escape(log.id.slice(-2))}</span><span class="chart-tooltip">${escape(log.id)} · ${log.score}/100</span></div>`).join('');
  renderChart('monthly');
  $('chartPeriods').onclick = event => { const button = event.target.closest('[data-period]'); if (!button) return; $('chartPeriods').querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button))); renderChart(button.dataset.period); };
  let sort = '', direction = 1;
  const renderTable = () => {
    const logs = selectLogs(SAMPLE_LOGS, $('conversationSearch').value, sort, direction);
    $('tableCount').textContent = `${logs.length} sample conversations`;
    $('conversationRows').innerHTML = logs.length ? logs.map(log => `<tr data-log="${log.id}"><td><a href="/logs?id=${log.id}" class="mono">${log.id}</a></td><td>${escape(log.caller)}</td><td>${escape(agentName(log.agent))}</td><td>${outcomePill(log.outcome)}</td><td class="mono">${log.dur}</td><td class="mono score-cell">${log.score}<small>/100</small></td><td><span class="channel-label">${icon(log.channel === 'Voice' ? 'mic' : 'logs')}${log.channel}</span></td><td><a href="/logs?id=${log.id}" aria-label="Open sample conversation ${log.id}">↗</a></td></tr>`).join('') : '<tr><td colspan="8" class="table-empty">No matching sample conversations.</td></tr>';
  };
  $('conversationSearch').oninput = renderTable;
  document.querySelectorAll('[data-sort]').forEach(button => { button.onclick = () => { direction = sort === button.dataset.sort ? -direction : 1; sort = button.dataset.sort; document.querySelectorAll('[data-sort]').forEach(item => item.closest('th').removeAttribute('aria-sort')); button.closest('th').setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending'); renderTable(); }; });
  $('conversationRows').onclick = event => { if (event.target.closest('a')) return; const row = event.target.closest('[data-log]'); if (row) location.assign('/logs?id=' + row.dataset.log); };
  renderTable();
}
export function mountLogs(agents) {
  let selected = SAMPLE_LOGS.find(log => log.id === new URLSearchParams(location.search).get('id')) || SAMPLE_LOGS[0];
  const renderDetail = () => {
    const scripted = SAMPLE_AGENTS.find(agent => agent.id === selected.agent), turns = scripted.turns.slice(0, selected.n), last = turns.at(-1);
    $('logDetail').innerHTML = `<div class="log-detail-heading"><div><span class="mono muted">${selected.id} · SAMPLE CONVERSATION</span><h2>${escape(selected.caller)}</h2><p>${escape(scripted.name)} · ${selected.when}</p></div><div>${outcomePill(selected.outcome)}<a class="button primary" href="${talkLink(agents, selected.agent)}">Try this agent ${icon('arrow')}</a></div></div><div class="log-stat-grid"><div><small>Duration</small><strong>${selected.dur}</strong></div><div><small>Decision score</small><strong>${selected.score}<small>/100</small></strong></div><div><small>Channel</small><strong>${selected.channel}</strong></div></div><section class="log-insight"><h3>${icon('spark')} Sample Jev summary</h3><p>${escape(last.sug.d)}</p><div><span>Suggested next step</span><strong>${escape(last.sug.t)}</strong></div></section><div class="log-transcript-heading"><h3>Transcript</h3><span>${turns.length * 2} messages · Scripted example</span></div><div class="log-transcript">${turns.map((turn, i) => `<div class="transcript-bubble customer"><div><b>${escape(selected.caller)}</b><time>00:${String(i * 14).padStart(2, '0')}</time></div><p>${escape(turn.u)}</p></div><div class="transcript-bubble agent"><div><b>${escape(scripted.name)}</b><time>00:${String(i * 14 + 5).padStart(2, '0')}</time></div><p>${escape(turn.a)}</p></div>`).join('')}</div><p class="sample-footnote">Fictional reference conversation. Bookings, account changes, and transfers shown here are examples; Cayana has no connected tools to perform them.</p>`;
  };
  const renderList = () => {
    const logs = selectLogs(SAMPLE_LOGS, $('logSearch').value);
    $('logList').innerHTML = logs.length ? logs.map(log => `<button class="log-list-item" type="button" data-id="${log.id}" ${selected.id === log.id ? 'aria-current="true"' : ''}><span><strong>${escape(log.caller)}</strong><small class="mono">${log.id}</small></span><p>${escape(agentName(log.agent))}</p><span><small>${log.when}</small>${outcomePill(log.outcome)}</span></button>`).join('') : '<p class="table-empty">No matching sample logs.</p>';
  };
  $('logSearch').oninput = renderList;
  $('logList').onclick = event => { const button = event.target.closest('[data-id]'); if (!button) return; selected = SAMPLE_LOGS.find(log => log.id === button.dataset.id); history.replaceState(null, '', '/logs?id=' + selected.id); renderList(); renderDetail(); };
  renderList(); renderDetail();
}
