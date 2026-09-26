// Fictional sample content supplied with the Metrix design; never live analytics.
const ICON = {
  overview: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  talk: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3',
  agents: 'M5 8h14v11H5z M12 4v4 M9 13h.01 M15 13h.01',
  logs: 'M5 4h14v16H5z M8 9h8 M8 13h8 M8 17h5',
  star: 'M12 3l1.9 5.8L20 10.5l-5.1 3.6L16.5 20 12 16.6 7.5 20l1.6-5.9L4 10.5l6.1-1.7z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  monitor: 'M3 5h18v11H3z M8 20h8 M12 16v4',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10'
};
const AGENTS = [
  { id: 'sales', name: 'Sales discovery', cat: 'Sales & growth', icon: ICON.star, desc: 'Turn a first conversation into a clear, qualified next step.', metric: 'Buying stage', stages: ['Just browsing', 'Exploring options', 'Evaluating us', 'Ready to buy'], sessions: '412', resolution: '64%', avg: '4m 05s', turns: [
    { u: "Hi, we're looking at voice tools for our inbound sales line.", a: 'Happy to help. What does your inbound line handle today, and roughly how many calls a week?', score: 22, stage: 0, sug: { t: 'Qualify volume', d: 'Ask about weekly call volume and who answers the phone today.' } },
    { u: 'About 400 calls a week. Two reps answer, and we miss a lot after hours.', a: 'That helps. If after-hours calls were answered and qualified, what would a good outcome look like for your team?', score: 48, stage: 1, sug: { t: 'Anchor the pain', d: 'Missed after-hours calls. Tie the value to recovered leads.' } },
    { u: "Booked demos in the reps' calendars by morning.", a: "We can do that. Are you comparing other options, and is there a date you'd like this live?", score: 71, stage: 2, sug: { t: 'Check the timeline', d: 'Confirm the decision date and any competing vendors.' } },
    { u: "We're deciding this month. Can someone walk us through pricing?", a: "Yes. I'll book a 30-minute pricing call with an account executive. Does Thursday at 10am work?", score: 88, stage: 3, sug: { t: 'Book the meeting', d: 'Offer a specific slot and hand off to an account executive.' } }
  ] },
  { id: 'concierge', name: 'Customer concierge', cat: 'Customer service', icon: ICON.heart, desc: 'Understand the request and find the right service path.', metric: 'Request status', stages: ['New request', 'Clarifying', 'Matching path', 'Resolved'], sessions: '356', resolution: '78%', avg: '2m 20s', turns: [
    { u: 'I need to change the delivery address on my order.', a: 'I can help with that. Could you share your order number?', score: 25, stage: 0, sug: { t: 'Identify the order', d: 'Ask for the order number before discussing changes.' } },
    { u: "It's 58213.", a: "Thanks. Order 58213 ships tomorrow, so the address can still be changed. What's the new address?", score: 55, stage: 1, sug: { t: 'Confirm eligibility', d: 'The order has not shipped. Address changes are allowed.' } },
    { u: '14 Harbor Street, Unit 3.', a: "Updated to 14 Harbor Street, Unit 3. You'll get a confirmation email shortly.", score: 82, stage: 2, sug: { t: 'Apply the change', d: 'Update the address and send a confirmation.' } },
    { u: "Great, that's all.", a: "Glad it's sorted. Have a good day.", score: 96, stage: 3, sug: { t: 'Close politely', d: 'Request resolved. No handoff needed.' } }
  ] },
  { id: 'it', name: 'IT service desk', cat: 'IT & operations', icon: ICON.monitor, desc: 'Separate routine requests from incidents that need a specialist.', metric: 'Ticket stage', stages: ['Reported', 'Triaging', 'Diagnosing', 'Resolved'], sessions: '298', resolution: '91%', avg: '2m 48s', turns: [
    { u: "My laptop can't connect to the VPN since this morning.", a: 'Sorry about that. Is anyone else on your team affected, or just you?', score: 20, stage: 0, sug: { t: 'Check the scope', d: 'Find out whether this is a single user or a wider outage.' } },
    { u: 'Just me, I think.', a: 'Okay. Which error do you see when you try to connect?', score: 45, stage: 1, sug: { t: 'Get the error', d: 'Single user. Likely a device or account issue.' } },
    { u: 'It says certificate expired.', a: "That's a routine fix. I'll push a new certificate to your device now. Restart the VPN client in two minutes.", score: 78, stage: 2, sug: { t: 'Run the routine fix', d: 'Expired certificate. Reissue it; no specialist needed.' } },
    { u: 'It works now, thanks.', a: "Great. I've logged this as resolved. Reply here if it drops again.", score: 95, stage: 3, sug: { t: 'Close the ticket', d: 'Confirm resolution and log the fix.' } }
  ] },
  { id: 'ship', name: 'Shipment intake', cat: 'Logistics', icon: ICON.box, desc: 'Gather shipment requirements before a quote or operations handoff.', metric: 'Quote readiness', stages: ['Route', 'Cargo details', 'Timing', 'Ready for quote'], sessions: '218', resolution: '69%', avg: '3m 30s', turns: [
    { u: 'I need a quote to ship pallets from Rotterdam to Chicago.', a: "I can gather the details for a quote. How many pallets, and what's the approximate weight?", score: 24, stage: 0, sug: { t: 'Capture the load', d: 'Route known. Ask for pallet count and weight.' } },
    { u: 'Six pallets, about 3,000 kg total.', a: 'Got it. Is any of the cargo hazardous or temperature-controlled?', score: 50, stage: 1, sug: { t: 'Check special handling', d: 'Ask about hazardous or temperature-controlled goods.' } },
    { u: 'No, just packaged furniture.', a: 'Thanks. When does it need to arrive in Chicago?', score: 72, stage: 2, sug: { t: 'Confirm the deadline', d: 'Standard cargo. Timing decides air or ocean freight.' } },
    { u: 'By the end of next month.', a: "That fits ocean freight. I'm sending these details to operations; you'll have a quote within one business day.", score: 92, stage: 3, sug: { t: 'Hand off to operations', d: 'All quote fields captured. Route to the operations team.' } }
  ] }
];
const LOGS = [
  { id: 'C-1048', caller: 'Maya Chen', agent: 'sales', outcome: 'Qualified', dur: '4m 12s', score: 88, channel: 'Voice', when: 'Today, 09:42', n: 4 },
  { id: 'C-1047', caller: 'Jonas Weber', agent: 'ship', outcome: 'Handed off', dur: '3m 05s', score: 92, channel: 'Voice', when: 'Today, 09:18', n: 4 },
  { id: 'C-1046', caller: 'Priya Nair', agent: 'it', outcome: 'Resolved', dur: '2m 31s', score: 95, channel: 'Text', when: 'Today, 08:55', n: 4 },
  { id: 'C-1045', caller: 'Luis Ortega', agent: 'concierge', outcome: 'Resolved', dur: '1m 48s', score: 96, channel: 'Voice', when: 'Yesterday, 17:22', n: 4 },
  { id: 'C-1044', caller: 'Ava Thompson', agent: 'sales', outcome: 'Dropped', dur: '0m 58s', score: 22, channel: 'Voice', when: 'Yesterday, 16:03', n: 1 },
  { id: 'C-1043', caller: 'Kenji Sato', agent: 'it', outcome: 'Escalated', dur: '5m 40s', score: 78, channel: 'Voice', when: 'Yesterday, 14:47', n: 3 },
  { id: 'C-1042', caller: 'Sofia Rossi', agent: 'concierge', outcome: 'Resolved', dur: '2m 10s', score: 82, channel: 'Text', when: 'Yesterday, 11:30', n: 3 },
  { id: 'C-1041', caller: 'Omar Haddad', agent: 'ship', outcome: 'In progress', dur: '2m 02s', score: 50, channel: 'Voice', when: 'Mon, 15:12', n: 2 }
];

const templateIds = { sales: 'sales', concierge: 'service', it: 'it-support', ship: 'logistics' };
export const SAMPLE_AGENTS = AGENTS.map(agent => ({ ...agent, id: templateIds[agent.id] }));
export const SAMPLE_LOGS = LOGS.map(log => ({ ...log, agent: templateIds[log.agent], sample: true }));
// Illustrative dashboard totals are separate from the eight example transcripts.
export const OVERVIEW_SAMPLE = { conversations: 1284, averageSeconds: 222, resolutionRate: 72.4, handoffs: 86, resolved: 930 };
export const SAMPLE_OUTCOMES = [
  [125, 84], [148, 98], [132, 92], [163, 116],
  [170, 128], [156, 114], [184, 138], [206, 160],
].map(([total, resolved], i) => ({ label: `W${i + 1}`, total, resolved }));

export function sampleTrend(period) {
  const labels = { weekly: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], monthly: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], yearly: ['2022', '2023', '2024', '2025', '2026'] }[period];
  const per = period === 'weekly' ? 6 : period === 'yearly' ? 9 : 4;
  const columns = Array.from({ length: labels.length * per }, (_, i) => {
    const voiceLevel = Math.max(1, Math.round(8 + Math.sin(i * .3) * 5 + Math.cos(i * 1.7) * 3));
    const text = 2 + i % 5;
    return { voiceLevel, textLevel: voiceLevel + text, voice: voiceLevel * 9, text: text * 9, label: labels[Math.floor(i / per)] };
  });
  return { labels, columns, total: columns.reduce((sum, col) => sum + col.voice + col.text, 0) };
}

const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const formatCount = value => wholeNumber.format(Math.round(value));
export function overviewNumbers(p, trendTotal) {
  const seconds = Math.round(OVERVIEW_SAMPLE.averageSeconds * p);
  return {
    conversations: formatCount(OVERVIEW_SAMPLE.conversations * p),
    average: `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`,
    rate: (OVERVIEW_SAMPLE.resolutionRate * p).toFixed(1) + '%',
    handoffs: formatCount(OVERVIEW_SAMPLE.handoffs * p),
    resolved: formatCount(OVERVIEW_SAMPLE.resolved * p),
    trend: formatCount(trendTotal * p),
  };
}
export const durationSeconds = value => { const parts = value.match(/^(\d+)m (\d+)s$/); return parts ? Number(parts[1]) * 60 + Number(parts[2]) : 0; };
export const formatDuration = seconds => `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
export function summarizeLogs(logs) {
  const resolved = logs.filter(log => ['Resolved', 'Qualified'].includes(log.outcome)).length;
  return { total: logs.length, resolved, rate: logs.length ? Math.round(resolved / logs.length * 100) : 0,
    handoffs: logs.filter(log => ['Handed off', 'Escalated'].includes(log.outcome)).length,
    average: logs.length ? Math.round(logs.reduce((sum, log) => sum + durationSeconds(log.dur), 0) / logs.length) : 0 };
}
export function selectLogs(logs, search = '', key = '', direction = 1) {
  const term = search.trim().toLowerCase();
  const filtered = logs.filter(log => [log.id, log.caller, log.outcome, SAMPLE_AGENTS.find(agent => agent.id === log.agent)?.name, log.channel].join(' ').toLowerCase().includes(term));
  return key ? filtered.toSorted((a, b) => {
    if (key === 'dur') return (durationSeconds(a.dur) - durationSeconds(b.dur)) * direction;
    if (key === 'score') return (a.score - b.score) * direction;
    const value = log => key === 'agent' ? SAMPLE_AGENTS.find(agent => agent.id === log.agent)?.name || log.agent : log[key];
    return String(value(a)).localeCompare(String(value(b))) * direction;
  }) : filtered;
}
