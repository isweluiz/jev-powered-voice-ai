import { apiPost } from './settings.js';

// Half-duplex turn loop: final STT results are drained before generation;
// microphone capture resumes only after playback ends.
export class AgentSession {
  constructor({ getTurns, getGuidance = async () => null, startInput, stopInput, voice, onReply, onState, onError, canSpeak }) {
    Object.assign(this, { getTurns, getGuidance, startInput, stopInput, voice, onReply, onState, onError, canSpeak });
    this.active = false; this.busy = false; this.revision = 0; this.timer = null; this.request = null;
  }
  async start() {
    if (this.active) return;
    this.active = true; this.onState('listening');
    await this.startInput();
  }
  transcript() {
    if (!this.active || this.busy) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reply(), 1400);
  }
  async end() {
    this.active = false; this.busy = false; this.revision++;
    clearTimeout(this.timer); this.request?.abort(); this.request = null; this.voice.stop();
    await this.stopInput(); this.onState('idle');
  }
  async reply() {
    if (this.busy || !this.getTurns().some(t => t.speaker === 'customer' && t.text.trim())) return;
    clearTimeout(this.timer); this.busy = true;
    const revision = ++this.revision;
    this.onState('thinking');
    try {
      await this.stopInput();
      if (revision !== this.revision) return;
      this.request = new AbortController();
      const turns = this.getTurns().map(turn => ({ speaker: turn.speaker, text: turn.text }));
      this.onState('evaluating');
      const guidance = await this.getGuidance(turns, this.request.signal);
      if (revision !== this.revision) return;
      this.onState('thinking');
      const res = await apiPost('/api/reply', { turns, guidance }, { signal: this.request.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not generate a reply.');
      if (revision !== this.revision) return;
      this.onReply(data.text);
      if (this.canSpeak()) {
        this.onState('speaking');
        await this.voice.speak(data.text);
        const completed = await this.voice.finished;
        if (revision !== this.revision) return;
        if (!completed) this.active = false;
      } else {
        this.active = false;
        this.onError('Reply ready. Add a Deepgram key in Settings to hear the agent.');
      }
      this.busy = false;
      if (this.active) { this.onState('listening'); await this.startInput(); }
      else this.onState('idle');
    } catch (error) {
      if (revision !== this.revision) return;
      this.active = false;
      if (error.name !== 'AbortError') this.onError(error.message);
      this.onState('idle');
    } finally {
      if (revision === this.revision) { this.busy = false; this.request = null; this.onState(this.active ? 'listening' : 'idle'); }
    }
  }
}
