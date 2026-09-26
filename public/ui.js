export const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const outcomeClass = outcome => ['Resolved', 'Qualified', 'Handed off'].includes(outcome) ? 'success' : outcome === 'Dropped' ? 'danger' : 'warning';
export const outcomePill = outcome => `<span class="status-pill ${outcomeClass(outcome)}">${escape(outcome)}</span>`;
