import { getSettings, apiPost } from './settings.js';

export class BrowserSpeech {
  constructor(callbacks) { Object.assign(this, callbacks); this.session = null; }
  get active() { return Boolean(this.session); }
  async start() {
    if (this.session) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { this.onError('This browser does not support speech recognition. Choose Bandwidth in Settings or use Chrome.'); return; }
    const rec = new Recognition();
    const s = this.session = { rec, kind: 'microphone', hadText: false };
    rec.continuous = true; rec.interimResults = false; rec.lang = navigator.language || 'en-US';
    rec.onstart = () => { if (this.session === s) this.onState('listening', 'microphone'); };
    rec.onresult = event => {
      if (this.session !== s) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          this.onText({ text: (s.hadText ? ' ' : '') + result[0].transcript });
          s.hadText = true;
        }
      }
    };
    rec.onerror = event => {
      if (this.session !== s) return;
      const message = event.error === 'network' ? 'The browser speech service could not connect. Try Chrome or select Bandwidth in Settings.'
        : ['not-allowed', 'service-not-allowed'].includes(event.error) ? 'The browser blocked microphone or speech-service access. Check its permissions.'
        : 'Browser speech recognition stopped. Press Start listening to retry.';
      this.onError(message); this.destroy();
    };
    rec.onend = () => {
      const emptyEnd = !s.stopping && !s.hadText;
      this.finish(s); // No automatic reconnect loop.
      if (emptyEnd) this.onError('Browser speech recognition ended without speech. Start listening again to retry.');
    };
    this.onState('starting', 'microphone');
    try { rec.start(); } catch { this.onError('Could not start browser speech recognition. Try Bandwidth in Settings.'); this.destroy(); }
  }
  finish(s) {
    clearTimeout(s.timer); s.resolve?.();
    if (this.session === s) { this.session = null; this.onState('idle', 'microphone'); }
  }
  async stop() {
    const s = this.session;
    if (!s) return;
    if (s.stopping) return s.stopping;
    this.onState('stopping', 'microphone');
    s.stopping = new Promise(resolve => {
      s.resolve = resolve;
      s.timer = setTimeout(() => this.destroy(), 2000);
      try { s.rec.stop(); } catch { this.destroy(); }
    });
    return s.stopping;
  }
  destroy() {
    const s = this.session;
    if (!s) return;
    s.rec.onend = null; s.rec.onerror = null; s.rec.onresult = null; s.rec.onstart = null;
    try { s.rec.abort(); } catch {}
    this.finish(s);
  }
}

export class BandwidthSpeech {
  constructor({ onText, onState, onError, onAnalyser }) { Object.assign(this, { onText, onState, onError, onAnalyser }); this.session = null; }
  get active() { return Boolean(this.session); }
  async start(kind = 'microphone') {
    if (this.session) return;
    const s = { kind, done: false, ready: false, stopping: false, drained: false };
    this.session = s;
    this.onState('starting', kind);
    try {
      const config = await getSettings();
      if (!config.configured.bandwidth) throw new Error('Add your Bandwidth STT key in Settings.');
      if (s.done) return;
      s.stream = kind === 'capture' ? await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
        : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (s.done) { s.stream.getTracks().forEach(t => t.stop()); return; }
      if (!s.stream.getAudioTracks().length) throw new Error('No audio was shared. Select a source with audio and enable Share audio.');
      for (const track of s.stream.getTracks()) track.onended = () => { this.stop(); };
      s.closed = new Promise(resolve => { s.resolveClosed = resolve; });
      const ws = s.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/stt`, ['call-coach', `csrf.${config.csrfToken}`]);
      await new Promise((resolve, reject) => {
        s.rejectOpening = reject;
        s.openingTimer = setTimeout(() => reject(new Error('Bandwidth did not connect. Check your key and try again.')), 15000);
        ws.onmessage = event => {
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.type === 'SessionOpened') { s.ready = true; clearTimeout(s.openingTimer); resolve(); }
          if (message.type === 'Segment' && typeof message.text === 'string' && !s.done) this.onText(message);
          if (message.type === 'SessionClosed') { s.drained = true; s.resolveClosed(); }
          if (message.type === 'Error') {
            const error = new Error(message.message || 'Bandwidth transcription failed.');
            reject(error); this.fail(s, error.message);
          }
        };
        ws.onerror = () => { const error = new Error('Could not connect to Bandwidth. Check your key in Settings and your connection.'); reject(error); this.fail(s, error.message); };
        ws.onclose = () => {
          s.resolveClosed();
          reject(new Error('The speech connection closed.'));
          if (!s.stopping && !s.done) this.fail(s, 'Speech recognition disconnected. Press Start listening to retry.');
        };
      });
      if (s.done) return;
      const ctx = s.ctx = new AudioContext({ sampleRate: 16000 });
      if (ctx.sampleRate !== 16000) throw new Error('This browser could not open 16 kHz audio. Try Chrome.');
      await ctx.resume();
      await ctx.audioWorklet.addModule('/pcm-worklet.js');
      if (s.done) return;
      s.source = ctx.createMediaStreamSource(new MediaStream(s.stream.getAudioTracks()));
      s.node = new AudioWorkletNode(ctx, 'bandwidth-pcm');
      s.node.port.onmessage = event => {
        if (event.data.type === 'flushed') { s.resolveFlush?.(); return; }
        if (event.data.type !== 'audio' || ws.readyState !== WebSocket.OPEN || s.done) return;
        if (ws.bufferedAmount > 256000) { this.fail(s, 'Audio upload is too slow. Restart listening when the connection improves.'); return; }
        ws.send(event.data.bytes);
      };
      s.analyser = ctx.createAnalyser(); s.analyser.fftSize = 256;
      s.source.connect(s.analyser).connect(s.node).connect(ctx.destination);
      this.onAnalyser?.(s.analyser);
      this.onState('listening', kind);
    } catch (error) {
      if (!s.done) this.fail(s, error.name === 'NotAllowedError' ? 'Microphone or screen-sharing permission was denied. Allow access and try again.' : error.message);
    }
  }
  fail(s, message) { if (!s.done) { this.onError(message); this.cleanup(s); } }
  cleanup(s) {
    if (s.done) return;
    s.done = true;
    clearTimeout(s.openingTimer);
    s.rejectOpening?.(new Error('Listening stopped.'));
    s.node?.disconnect(); s.source?.disconnect(); s.analyser?.disconnect();
    this.onAnalyser?.(null);
    s.stream?.getTracks().forEach(t => t.stop());
    s.ctx?.close().catch(() => {});
    if (s.ws && s.ws.readyState < WebSocket.CLOSING) s.ws.close();
    s.resolveClosed?.(); s.resolveFlush?.();
    if (this.session === s) { this.session = null; this.onState('idle', s.kind); }
  }
  async stop() {
    const s = this.session;
    if (!s) return;
    if (s.stopPromise) return s.stopPromise;
    s.stopping = true;
    this.onState('stopping', s.kind);
    s.stopPromise = (async () => {
      try {
        if (s.node && s.ws.readyState === WebSocket.OPEN) {
          await new Promise(resolve => {
            const timeout = setTimeout(resolve, 500);
            s.resolveFlush = () => { clearTimeout(timeout); resolve(); };
            s.node.port.postMessage('flush');
          });
          s.stream.getTracks().forEach(t => t.stop());
          if (s.ws.readyState === WebSocket.OPEN) {
            s.ws.send(JSON.stringify({ type: 'CloseStream' }));
            let timer;
            await Promise.race([s.closed, new Promise(resolve => { timer = setTimeout(resolve, 11000); })]);
            clearTimeout(timer);
            if (!s.drained && !s.done) this.onError('Transcription ended before final results were confirmed.');
          }
        }
      } finally { this.cleanup(s); }
    })();
    return s.stopPromise;
  }
  destroy() { if (this.session) this.cleanup(this.session); }
}

// Segment text can contain subword pieces. Never trim, add spaces, or deduplicate deltas.
export class TranscriptAssembler {
  constructor() { this.reset(); }
  reset() { this.turn = null; this.end = null; }
  append(turns, segment, speaker) {
    const boundary = /^\s/.test(segment.text) && (this.turn?.text.length > 1200 || (Number.isFinite(segment.start) && this.end != null && segment.start - this.end > 1.2));
    if (!this.turn || this.turn.speaker !== speaker || boundary || !turns.includes(this.turn)) {
      this.turn = { speaker, text: '', at: Date.now(), merge: false };
      turns.push(this.turn);
    }
    this.turn.text += segment.text;
    this.end = Number.isFinite(segment.end) ? segment.end : this.end;
    return this.turn;
  }
}

// Decode arbitrary network boundaries into 100 ms PCM frames, retaining odd bytes.
export class PCMFrames {
  constructor() { this.pending = new Uint8Array(); }
  push(chunk, flush = false) {
    const bytes = new Uint8Array(this.pending.length + chunk.length);
    bytes.set(this.pending); bytes.set(chunk, this.pending.length);
    if (flush && bytes.length % 2) throw new Error('The audio stream ended with an incomplete sample.');
    const frames = []; let offset = 0;
    while (bytes.length - offset >= 4800 || (flush && offset < bytes.length)) {
      const size = Math.min(4800, bytes.length - offset);
      const data = new DataView(bytes.buffer, offset, size);
      const samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = data.getInt16(i * 2, true) / 32768;
      frames.push(samples); offset += size;
    }
    this.pending = bytes.slice(offset);
    return frames;
  }
}

export function audioResponseFormat(headers) {
  const contentType = (headers.get('content-type') || '').toLowerCase();
  const mime = contentType.split(';')[0].trim();
  if (mime === 'audio/l16') {
    const declaredRate = contentType.match(/(?:^|;)\s*rate\s*=\s*"?(\d+)"?(?:\s*;|\s*$)/)?.[1];
    const customRate = headers.get('x-audio-sample-rate')?.trim();
    if (declaredRate && customRate && declaredRate !== customRate) throw new Error('The audio response has conflicting sample rates. Restart the local server and retry.');
    if ((declaredRate || customRate) !== '24000') throw new Error('The audio response must specify 24 kHz PCM. Restart the local server and retry.');
    return 'pcm';
  }
  // An already-running server may still return the previous MP3 response after
  // frontend files change. Browser decoding keeps that response playable.
  if (['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave'].includes(mime)) return 'encoded';
  throw new Error(`The server returned an unsupported audio format (${mime.slice(0, 80) || 'no content type'}). Restart the local server and retry.`);
}

export class DeepgramSpeech {
  constructor({ onState, onAnalyser }) {
    Object.assign(this, { onState, onAnalyser });
    this.session = null; this.context = null; this.state = 'idle'; this.streaming = true;
    this.finished = Promise.resolve(false);
  }
  get active() { return Boolean(this.session); }
  setState(state) { this.state = state; this.onState(state); }
  ensureContext() {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 256;
      this.analyser.connect(this.context.destination);
    }
  }
  // Call directly from a click/submit gesture, before STT or model awaits.
  async unlock() { this.ensureContext(); await this.context.resume(); }
  async togglePause() {
    if (!this.active) return;
    if (this.context.state === 'running') { await this.context.suspend(); this.setState('paused'); }
    else { await this.context.resume(); if (this.active) this.setState('playing'); }
  }
  stop(completed = false) {
    const s = this.session; this.session = null;
    if (s) {
      s.controller.abort(); s.reader?.cancel().catch(() => {});
      for (const node of s.nodes) { node.onended = null; try { node.stop(); } catch {} node.disconnect(); }
      s.nodes.clear(); s.resolve(completed);
    }
    this.onAnalyser?.(null); this.setState('idle');
  }
  enqueue(s, samples, sampleRate = 24000) {
    if (this.session !== s || !samples.length) return;
    const ctx = this.context;
    const buffer = ctx.createBuffer(1, samples.length, sampleRate); buffer.copyToChannel(samples, 0);
    const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(this.analyser);
    s.nodes.add(node);
    node.onended = () => {
      node.disconnect(); s.nodes.delete(node);
      if (this.session === s && s.ended && !s.nodes.size) this.stop(true);
    };
    const at = Math.max(s.cursor, ctx.currentTime + .06);
    node.start(at); s.cursor = at + buffer.duration;
    if (!s.started) {
      s.started = true; this.onAnalyser?.(this.analyser);
      this.setState(ctx.state === 'running' ? 'playing' : 'ready');
    }
  }
  async speak(text, voice) {
    this.stop(); this.ensureContext();
    // A browser may require the explicit Play button if no gesture unlocked audio.
    this.context.resume().catch(() => {});
    const s = { controller: new AbortController(), nodes: new Set(), cursor: 0, ended: false, started: false };
    this.session = s; this.finished = new Promise(resolve => { s.resolve = resolve; });
    this.setState('loading');
    try {
      const res = await apiPost('/api/tts', { text, ...(voice ? { voice } : {}) }, { signal: s.controller.signal });
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Could not generate speech.'); }
      if (this.session !== s) { await res.body?.cancel(); return; }
      s.reader = res.body.getReader();
      const format = audioResponseFormat(res.headers);
      this.streaming = format === 'pcm';
      const decoder = this.streaming ? new PCMFrames() : null;
      const encodedChunks = []; let received = 0;
      while (true) {
        const { value, done } = await s.reader.read();
        if (this.session !== s) return;
        if (done) break;
        received += value.length;
        if (received > 10000000) throw new Error('The audio stream is too large.');
        if (decoder) for (const frame of decoder.push(value)) this.enqueue(s, frame);
        else encodedChunks.push(value);
      }
      if (!received) throw new Error('No audio was received.');
      if (decoder) for (const frame of decoder.push(new Uint8Array(), true)) this.enqueue(s, frame);
      else {
        const encoded = new Uint8Array(received); let offset = 0;
        for (const chunk of encodedChunks) { encoded.set(chunk, offset); offset += chunk.length; }
        const decoded = await this.context.decodeAudioData(encoded.buffer);
        if (this.session !== s) return;
        const samples = new Float32Array(decoded.length);
        for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
          const data = decoded.getChannelData(channel);
          for (let i = 0; i < data.length; i++) samples[i] += data[i] / decoded.numberOfChannels;
        }
        this.enqueue(s, samples, decoded.sampleRate);
      }
      s.ended = true;
      if (!s.nodes.size) this.stop(true);
    } catch (error) {
      if (this.session !== s) return;
      this.stop();
      if (error.name !== 'AbortError') throw error;
    }
  }
  destroy() { this.stop(); this.context?.close().catch(() => {}); }
}
