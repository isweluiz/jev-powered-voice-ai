import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../public/speech.js', import.meta.url), 'utf8')).replace("import { getSettings, apiPost } from './settings.js';", 'const getSettings = () => globalThis.testSettings(); const apiPost = (...args) => globalThis.testPost(...args);');
const { TranscriptAssembler, BrowserSpeech, BandwidthSpeech, PCMFrames, DeepgramSpeech, audioResponseFormat } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('streaming assembly preserves leading spaces, repetitions and subword pieces exactly', () => {
  const assembler = new TranscriptAssembler(); const turns = [];
  for (const text of ['i need', ' a dr', 'y van', ' van']) assembler.append(turns, { text }, 'customer');
  assert.equal(turns.length, 1); assert.equal(turns[0].text, 'i need a dry van van');
  assembler.reset(); assembler.append(turns, { text: 'Sure.' }, 'rep');
  assert.equal(turns[1].speaker, 'rep');
  assert.equal(turns[0].text, 'i need a dry van van');
});

test('worklet emits 160 ms little-endian PCM16 and pads/drains a short tail', async () => {
  let Processor;
  const messages = [];
  class WorkletBase { constructor() { this.port = { postMessage: message => messages.push(message) }; } }
  vm.runInNewContext(await readFile(new URL('../public/pcm-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: WorkletBase, registerProcessor: (_name, constructor) => { Processor = constructor; },
    Int16Array, ArrayBuffer, DataView, Math,
  });
  const processor = new Processor();
  for (let i = 0; i < 20; i++) processor.process([[new Float32Array(128).fill(.5)]]);
  assert.equal(messages.length, 1); assert.equal(messages[0].bytes.byteLength, 5120);
  assert.equal(new DataView(messages[0].bytes).getInt16(0, true), 16384);
  processor.process([[new Float32Array(128).fill(-1)]]);
  processor.port.onmessage({ data: 'flush' });
  assert.equal(messages[1].bytes.byteLength, 640);
  const tail = new DataView(messages[1].bytes);
  assert.equal(tail.getInt16(0, true), -32768); assert.equal(tail.getInt16(638, true), 0);
  assert.equal(messages[2].type, 'flushed'); assert.equal(processor.process([]), false);
});

test('browser network failure stops recognition without an automatic reconnect loop', async () => {
  let starts = 0, aborts = 0, recognition;
  const previousWindow = globalThis.window;
  globalThis.window = { SpeechRecognition: class {
    constructor() { recognition = this; }
    start() { starts++; this.onstart(); }
    abort() { aborts++; }
  } };
  try {
    const errors = [], states = [];
    const browser = new BrowserSpeech({ onText() {}, onError: error => errors.push(error), onState: state => states.push(state) });
    await browser.start();
    recognition.onerror({ error: 'network' });
    assert.equal(starts, 1); assert.equal(aborts, 1); assert.equal(browser.active, false);
    assert.match(errors[0], /select Bandwidth/); assert.equal(states.at(-1), 'idle');
    assert.equal(recognition.onend, null);
  } finally { globalThis.window = previousWindow; }
});

test('Bandwidth cancellation during the permission prompt stops tracks acquired later', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let resolveMedia; let stopped = 0;
  globalThis.testSettings = async () => ({ configured: { bandwidth: true }, csrfToken: 'dummy' });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: () => new Promise(resolve => { resolveMedia = resolve; }) },
  } });
  try {
    const speech = new BandwidthSpeech({ onText() {}, onState() {}, onError: message => assert.fail(message) });
    const starting = speech.start();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(typeof resolveMedia, 'function');
    await speech.stop();
    resolveMedia({ getTracks: () => [{ stop: () => stopped++ }] });
    await starting;
    assert.equal(stopped, 1); assert.equal(speech.active, false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
    delete globalThis.testSettings;
  }
});

test('browser ending without a transcript reports the stopped input to the agent', async () => {
  let recognition;
  const previousWindow = globalThis.window;
  globalThis.window = { SpeechRecognition: class {
    constructor() { recognition = this; }
    start() { this.onstart(); }
  } };
  try {
    const errors = [];
    const browser = new BrowserSpeech({ onText() {}, onError: error => errors.push(error), onState() {} });
    await browser.start(); recognition.onend();
    assert.equal(browser.active, false);
    assert.match(errors[0], /ended without speech/);
  } finally { globalThis.window = previousWindow; }
});

test('PCM output preserves samples across odd byte boundaries and rejects a truncated tail', () => {
  const decoder = new PCMFrames();
  assert.deepEqual(decoder.push(new Uint8Array([0, 128, 255])), []);
  assert.deepEqual(decoder.push(new Uint8Array([127, 0, 0])), []);
  const [frame] = decoder.push(new Uint8Array(), true);
  assert.deepEqual([...frame], [-1, 32767 / 32768, 0]);
  decoder.push(new Uint8Array([0]));
  assert.throws(() => decoder.push(new Uint8Array(), true), /incomplete sample/);
});

test('standard PCM metadata works without a custom header; incompatible rates and non-audio responses fail', () => {
  assert.equal(audioResponseFormat(new Headers({ 'Content-Type': 'audio/l16;rate=24000' })), 'pcm');
  assert.equal(audioResponseFormat(new Headers({ 'Content-Type': 'Audio/L16; rate="24000"' })), 'pcm');
  assert.equal(audioResponseFormat(new Headers({ 'Content-Type': 'audio/l16', 'X-Audio-Sample-Rate': '24000' })), 'pcm');
  for (const type of ['audio/mpeg', 'audio/wav']) assert.equal(audioResponseFormat(new Headers({ 'Content-Type': type })), 'encoded');
  assert.throws(() => audioResponseFormat(new Headers({ 'Content-Type': 'audio/l16;rate=16000', 'X-Audio-Sample-Rate': '24000' })), /conflicting sample rates/);
  assert.throws(() => audioResponseFormat(new Headers({ 'Content-Type': 'audio/l16;rate=16000' })), /24 kHz/);
  assert.throws(() => audioResponseFormat(new Headers({ 'Content-Type': 'text/html' })), /text\/html/);
});

test('an older encoded audio response decodes at its actual rate and waits for playback completion', async () => {
  const previousContext = globalThis.AudioContext; let source, rate;
  globalThis.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createAnalyser() { return { connect() {} }; }
    resume() { return Promise.resolve(); }
    async decodeAudioData(bytes) {
      assert.equal(bytes.byteLength, 3);
      return { length: 3, numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array([0, .1, 0]) };
    }
    createBuffer(_channels, length, sampleRate) { rate = sampleRate; return { duration: length / sampleRate, copyToChannel() {} }; }
    createBufferSource() { return source = { connect() {}, disconnect() {}, start() {}, stop() {} }; }
  };
  globalThis.testPost = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } });
  try {
    const voice = new DeepgramSpeech({ onState() {} }); await voice.speak('Compatible reply');
    assert.equal(rate, 48000); assert.equal(voice.streaming, false); assert.equal(voice.active, true);
    const finished = voice.finished; source.onended();
    assert.equal(await finished, true); assert.equal(voice.active, false);
  } finally { globalThis.AudioContext = previousContext; delete globalThis.testPost; }
});

test('voice starts before the response finishes and Stop cancels queued audio and the stream', async () => {
  const previousContext = globalThis.AudioContext; const sources = [];
  globalThis.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createAnalyser() { return { connect() {} }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    createBuffer(_channels, length, sampleRate) { return { duration: length / sampleRate, copyToChannel() {} }; }
    createBufferSource() { const node = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } }; sources.push(node); return node; }
  };
  let cancelled = false, requestSignal, playing;
  const started = new Promise(resolve => { playing = resolve; });
  globalThis.testPost = async (_path, _body, { signal }) => {
    requestSignal = signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4800)); }, cancel() { cancelled = true; } }),
      { headers: { 'Content-Type': 'audio/l16;rate=24000', 'X-Audio-Sample-Rate': '24000' } });
  };
  try {
    const voice = new DeepgramSpeech({ onState: state => { if (state === 'playing') playing(); } });
    const pending = voice.speak('Test streaming'); await started;
    assert.ok(sources[0].started); assert.equal(voice.active, true);
    await voice.togglePause(); assert.equal(voice.state, 'paused');
    await voice.togglePause(); assert.equal(voice.state, 'playing');
    const finished = voice.finished; voice.stop(); await pending;
    assert.equal(await finished, false); assert.ok(requestSignal.aborted); assert.ok(cancelled);
    assert.ok(sources[0].stopped); assert.equal(voice.active, false);
  } finally { globalThis.AudioContext = previousContext; delete globalThis.testPost; }
});
