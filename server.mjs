import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSettings, validatePreferences } from './lib/settings.mjs';
import { attachBandwidth } from './lib/bandwidth.mjs';
import { generateReply } from './lib/agent.mjs';
import { createAuth, sameToken } from './lib/auth.mjs';
import { loadEnvironment, connectionLimit } from './lib/runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const QUESTIONS = JSON.parse(await readFile(path.join(HERE, 'schema.json'), 'utf8'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const error = (message, status = 400) => Object.assign(new Error(message), { status });

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}
async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw error('Send application/json.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 200_000) throw error('Request is too large.', 413);
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw error('Request body must be a JSON object.'); }
}
function cleanTurns(input) {
  return Array.isArray(input) ? input.filter(t => t && typeof t.text === 'string' && t.text.trim()).slice(-40)
    .map(t => ({ speaker: t.speaker === 'rep' ? 'sales_rep' : 'customer', text: t.text.trim().slice(0, 1500) })) : [];
}

// Endpoints are injectable for offline integration tests, never through browser settings.
export async function createApp({ env = process.env, envPath = path.join(HERE, '.env'), endpoints = {}, authStore, google } = {}) {
  env = await loadEnvironment(envPath, env);
  if (env.AUTH_MODE === 'local' && env.HOST && !['127.0.0.1', 'localhost', '::1'].includes(env.HOST)) throw new Error('Local mode cannot listen on a network interface.');
  const settings = await createSettings(envPath, env);
  const auth = await createAuth({ env, store: authStore, google });
  const token = randomBytes(32).toString('hex');
  const model = env.TYPESAFE_MODEL || 'jev-latest';
  const jevEndpoint = endpoints.jev || 'https://api.typesafe.ai/v1/systemone';
  const ttsEndpoint = endpoints.tts || 'https://api.deepgram.com/v1/speak';
  const agentEndpoint = endpoints.agent || 'https://api.openai.com/v1/responses';
  let agentActive = 0;
  let ttsActive = 0;
  const activeByUser = new Map();
  const maxReplies = connectionLimit(env.MAX_CONCURRENT_REPLIES, auth.enabled ? 8 : 2);
  const maxSpeech = connectionLimit(env.MAX_CONCURRENT_TTS, auth.enabled ? 8 : 2);
  const maxStreams = connectionLimit(env.MAX_CONCURRENT_STT, auth.enabled ? 8 : 2);
  function origins() {
    const port = server.address()?.port;
    return auth.origin ? [auth.origin] : [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
  }
  function validHost(req) { return origins().some(origin => new URL(origin).host === req.headers.host); }
  function allowed(req) {
    const expected = origins().find(origin => new URL(origin).host === req.headers.host);
    return Boolean(expected) && (!req.headers.origin || req.headers.origin === expected) && req.headers['sec-fetch-site'] !== 'cross-site';
  }
  function acquire(user, kind) {
    const key = `${user.id}:${kind}`;
    if (auth.enabled && activeByUser.has(key)) throw error('Your previous request is still running. Wait a moment.', 429);
    activeByUser.set(key, (activeByUser.get(key) || 0) + 1);
    return () => { const count = activeByUser.get(key) - 1; if (count) activeByUser.set(key, count); else activeByUser.delete(key); };
  }
  async function authenticate(req) {
    return auth.enabled ? auth.authenticate(req) : { user: { id: 'local', role: 'admin' }, csrfToken: token, preferences: {}, expiresAt: null };
  }
  function settingsFor(session) {
    const base = settings.status();
    const status = auth.enabled ? { ...base, ...validatePreferences(session.preferences, base) } : base;
    return { key: settings.key, voice: () => status.voice, status: () => status };
  }
  function statusFor(session, view) {
    return { ...view.status(), csrfToken: session.csrfToken, user: auth.enabled ? session.user : null,
      storage: auth.enabled ? 'account' : 'local', canManageKeys: session.user.role === 'admin' };
  }
  async function staticFile(res, requested) {
    const resolved = path.resolve(PUBLIC, '.' + requested);
    if (resolved.startsWith(PUBLIC + path.sep) && MIME[path.extname(resolved)]) {
      try { const content = await readFile(resolved); res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] }); res.end(content); return true; }
      catch {}
    }
    return false;
  }
  async function askJev(turns, signal) {
    const key = settings.key('jev');
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(jevEndpoint, { method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state: { sales_call_transcript: turns }, questions: QUESTIONS }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), redirect: 'error' });
      if ([429, 529].includes(response.status) && attempt < 3) {
        const delay = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        await sleep(Number.isFinite(delay) && delay > 0 ? Math.min(delay * 1000, 5000) : 300 * 2 ** attempt, undefined, { signal });
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw error(response.status === 401 || response.status === 403 ? 'Jev rejected the API key. Update it in Settings.' : `Jev returned status ${response.status}. Try again later.`, 502);
      }
      const data = await response.json();
      if (!data.answers || typeof data.answers !== 'object') throw error('Jev returned an invalid response.', 502);
      return { answers: data.answers, model: data.model, usage: data.usage };
    }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (!validHost(req)) return sendJson(res, 403, { error: 'This hostname is not allowed.' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      const redirect = (location, cookies) => { res.writeHead(303, { Location: location, ...(cookies ? { 'Set-Cookie': cookies } : {}) }); res.end(); };
      if (req.method === 'GET' && ['/login', '/login.html', '/login.css', '/login.js'].includes(url.pathname)) {
        if (await staticFile(res, url.pathname === '/login' ? '/login.html' : url.pathname)) return;
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/status') {
        const session = await authenticate(req);
        return sendJson(res, 200, { enabled: auth.enabled, configured: auth.configured, user: auth.enabled ? session?.user || null : null });
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/google') {
        if (!allowed(req)) return sendJson(res, 403, { error: 'Cross-origin sign-in is not allowed.' });
        if (!auth.configured) return redirect('/login?reason=setup');
        const start = await auth.begin(); return redirect(start.location, start.cookie);
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/google/callback') {
        try { const result = await auth.complete(req, url); return redirect('/', result.cookies); }
        catch (error) {
          const reason = ['setup', 'expired', 'cancelled', 'denied'].includes(error.authCode) ? error.authCode : 'failed';
          return redirect('/login?reason=' + reason, auth.clearLoginCookie());
        }
      }
      const session = await authenticate(req);
      if (!session) {
        if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return redirect('/login');
        return sendJson(res, 401, { error: 'Sign in to continue.' });
      }
      if (req.method === 'POST' && (!allowed(req) || !sameToken(req.headers['x-call-coach-token'], session.csrfToken))) return sendJson(res, 403, { error: 'Reload the page before trying again.' });
      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        const cookie = await auth.logout(session); speech.revokeSession(session.hash);
        res.setHeader('Set-Cookie', cookie); return sendJson(res, 200, { signedOut: true });
      }
      const view = settingsFor(session);
      if (req.method === 'GET' && url.pathname === '/api/settings') return sendJson(res, 200, statusFor(session, view));
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        const change = await readJson(req);
        try {
          if (auth.enabled) {
            if (change.keys != null && (typeof change.keys !== 'object' || Array.isArray(change.keys))) throw error('Invalid keys.');
            if (change.persist != null && typeof change.persist !== 'boolean') throw error('Invalid storage choice.');
            const updateKeys = (change.keys && Object.keys(change.keys).length) || change.persist;
            if (updateKeys && session.user.role !== 'admin') return sendJson(res, 403, { error: 'Only an administrator can change provider keys.' });
            const preferences = validatePreferences(change, view.status());
            if (updateKeys) await settings.update({ keys: change.keys, persist: change.persist });
            await auth.store.savePreferences(session.user.id, preferences);
            session.preferences = preferences;
            return sendJson(res, 200, { ...statusFor(session, settingsFor(session)), persisted: true });
          }
          return sendJson(res, 200, { ...await settings.update(change), ...statusFor(session, settings) });
        }
        catch (e) {
          // Filesystem errors and provider credentials must never be reflected.
          return sendJson(res, 400, { error: e.code ? 'Could not save settings. Check the server’s storage connection and permissions.' : e.message });
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, {
        ready: Boolean(settings.key('jev')), model, canTranscribe: Boolean(settings.key('bandwidth')),
        canSpeak: Boolean(settings.key('deepgram')), canReply: Boolean(settings.key('openai')),
        sttProvider: view.status().sttProvider, ttsProvider: 'Deepgram',
      });
      if (req.method === 'POST' && url.pathname === '/api/evaluate') {
        if (!settings.key('jev')) throw error('Add your Jev API key in Settings.', 503);
        const clean = cleanTurns((await readJson(req)).turns);
        if (!clean.some(t => t.speaker === 'customer')) throw error('Add at least one thing the customer said.');
        const started = performance.now();
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', abort);
        try { return sendJson(res, 200, { ...await askJev(clean, controller.signal), latency_ms: Math.round(performance.now() - started) }); }
        finally { res.off('close', abort); }
      }
      if (req.method === 'POST' && url.pathname === '/api/tts') {
        if (!settings.key('deepgram')) throw error('Add your Deepgram API key in Settings.', 503);
        const { text, voice = view.voice() } = await readJson(req);
        if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw error('Speech text must be 1–2000 characters.');
        if (!settings.status().voices.some(v => v.id === voice)) throw error('Choose one of the available voices.');
        if (ttsActive >= maxSpeech) throw error('Speech is busy. Stop playback or wait a moment.', 429);
        const releaseUser = acquire(session.user, 'tts');
        ttsActive++;
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', abort);
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const endpoint = new URL(ttsEndpoint);
          endpoint.searchParams.set('model', voice);
          endpoint.searchParams.set('encoding', 'linear16');
          endpoint.searchParams.set('container', 'none');
          endpoint.searchParams.set('sample_rate', '24000');
          const upstream = await fetch(endpoint, { method: 'POST',
            headers: { Authorization: `Token ${settings.key('deepgram')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text.trim() }), signal: controller.signal, redirect: 'error' });
          if (!upstream.ok) {
            await upstream.body?.cancel();
            throw error(upstream.status === 401 || upstream.status === 403 ? 'Deepgram rejected the API key. Update it in Settings.' : `Deepgram returned status ${upstream.status}. Try again later.`, 502);
          }
          if (!upstream.headers.get('content-type')?.toLowerCase().startsWith('audio/l16')) {
            await upstream.body?.cancel();
            throw error('Deepgram did not return PCM audio.', 502);
          }
          let size = 0;
          for await (const chunk of upstream.body) {
            size += chunk.length;
            if (size > 10_000_000) { controller.abort(); throw error('Speech response is too large.', 502); }
            if (!chunk.length) continue;
            if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'audio/l16;rate=24000', 'X-Audio-Sample-Rate': '24000', 'X-Accel-Buffering': 'no' });
            if (!res.write(chunk)) await once(res, 'drain', { signal: controller.signal });
          }
          if (!size) throw error('Deepgram returned empty audio.', 502);
          if (size % 2) throw error('Deepgram returned incomplete PCM audio.', 502);
          return res.end();
        } finally { clearTimeout(timeout); res.off('close', abort); ttsActive--; releaseUser(); }
      }
      if (req.method === 'POST' && url.pathname === '/api/reply') {
        const { turns, guidance } = await readJson(req);
        if (agentActive >= maxReplies) throw error('Reply capacity is busy. Wait a moment.', 429);
        const releaseUser = acquire(session.user, 'reply');
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        const timer = setTimeout(() => controller.abort(), 30_000);
        res.on('close', abort); agentActive++;
        try {
          return sendJson(res, 200, await generateReply({ settings: view, turns, guidance, endpoint: agentEndpoint, signal: controller.signal }));
        } finally { clearTimeout(timer); res.off('close', abort); agentActive--; releaseUser(); }
      }
      if (req.method === 'GET') {
        const requested = url.pathname === '/' ? '/index.html' : url.pathname;
        if (await staticFile(res, requested)) return;
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
      if (res.headersSent && !res.writableEnded) res.destroy();
      else if (!res.destroyed) sendJson(res, e.status || 502, { error: e.status ? e.message : 'The provider request failed or timed out. Check your connection and try again.' });
    }
  });
  const speech = attachBandwidth(server, { allowed, authenticate, settings, maxStreams, perUser: auth.enabled,
    endpoint: endpoints.stt || 'wss://api.labs.bandwidth.com/audio/v1/listen' });
  return { server, settings, auth, host: env.HOST || '127.0.0.1', port: Number(env.PORT || 3456), async close() {
    for (const client of speech.clients) client.terminate();
    speech.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await auth.close();
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const app = await createApp();
    app.server.on('error', async () => {
      console.error('Cayana could not listen on the configured address. Check HOST and PORT.');
      process.exitCode = 1; await app.close();
    });
    app.server.listen(app.port, app.host, () => console.log(`Cayana running at ${app.auth.origin || `http://127.0.0.1:${app.port}`}${app.auth.enabled && !app.auth.configured ? ' · Google sign-in awaits configuration' : ''}`));
    let closing = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await app.close();
    });
  } catch {
    console.error('Cayana could not start. Check the database connection and server configuration.');
    process.exitCode = 1;
  }
}
