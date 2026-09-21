import { apiPost } from './settings.js';

export function transcriptKey(turns) {
  return JSON.stringify(turns.filter(t => t?.text?.trim()).slice(-40)
    .map(t => ({ speaker: t.speaker === 'rep' ? 'rep' : 'customer', text: t.text.trim().slice(0, 1500) })));
}

// Share the exact-turn evaluation between the gauge and the reply pipeline.
// A timed-out reply waiter never uses an older turn's suggestion.
export class JevClient {
  constructor() { this.requests = new Map(); }
  clear() { for (const entry of this.requests.values()) entry.controller.abort(); this.requests.clear(); }
  evaluate(turns, { signal, waitMs } = {}) {
    if (signal?.aborted) return Promise.reject(new DOMException('Reply cancelled.', 'AbortError'));
    const key = transcriptKey(turns);
    let entry = this.requests.get(key);
    if (!entry) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      entry = { controller };
      entry.promise = (async () => {
        const response = await apiPost('/api/evaluate', { turns: JSON.parse(key) }, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Jev evaluation failed.');
        return data;
      })().catch(error => { if (this.requests.get(key) === entry) this.requests.delete(key); throw error; })
        .finally(() => clearTimeout(timer));
      this.requests.set(key, entry);
      if (this.requests.size > 4) {
        const oldest = this.requests.keys().next().value;
        this.requests.get(oldest).controller.abort(); this.requests.delete(oldest);
      }
    }
    if (!signal && !waitMs) return entry.promise;
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(new DOMException('Reply cancelled.', 'AbortError')); };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      if (waitMs) timer = setTimeout(() => { cleanup(); reject(new Error('Jev guidance timed out.')); }, waitMs);
      entry.promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }
}
