import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { createApp } from '../server.mjs';
import { createAuth } from '../lib/auth.mjs';

const development = { AUTH_MODE: 'development', NODE_ENV: 'development' };
const cookiePair = response => response.headers.get('set-cookie').split(';')[0];
const listen = async server => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
};
async function fixture(t, env = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cayana-dev-auth-'));
  const upstream = http.createServer();
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', ws => ws.send(JSON.stringify({ type: 'SessionOpened' })));
  const upstreamUrl = await listen(upstream);
  const app = await createApp({ env: { ...development, BW_STT_API_KEY: 'development-test-provider-key', ...env },
    envPath: path.join(dir, '.env'), endpoints: { stt: upstreamUrl.replace('http:', 'ws:') + '/listen' } });
  const origin = await listen(app.server);
  // Raw HTTP preserves hostile Host/Origin headers for the boundary checks below.
  const request = (route, options = {}) => new Promise((resolve, reject) => {
    const req = http.request(origin + route, { method: options.method || 'GET', headers: options.headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const headers = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
      });
    });
    req.on('error', reject);
    req.end(options.body);
  });
  const post = (route, body = {}, headers = {}) => request(route, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  async function login(headers = {}) {
    const response = await post('/api/auth/development', {}, headers);
    assert.equal(response.status, 200);
    const cookie = cookiePair(response);
    const settings = await (await request('/api/settings', { headers: { Cookie: cookie } })).json();
    return { cookie, settings, response };
  }
  const socket = (user = {}) => new WebSocket(origin.replace('http:', 'ws:') + '/api/stt',
    ['call-coach', `csrf.${user.settings?.csrfToken || 'missing'}`], { origin, headers: { Cookie: user.cookie || '' } });
  t.after(async () => {
    await app.close();
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return { app, dir, request, post, login, socket };
}

test('developer mode requires explicit development configuration and a loopback address', async () => {
  for (const NODE_ENV of [undefined, 'test', 'production']) {
    await assert.rejects(createAuth({ env: { ...development, NODE_ENV } }), /requires NODE_ENV=development/);
  }
  for (const extra of [{ HOST: '0.0.0.0' }, { HOST: '::' }, { APP_BASE_URL: 'https://cayana.example' }]) {
    await assert.rejects(createApp({ env: { ...development, ...extra }, envPath: '/nonexistent-cayana-env' }), /only available on localhost/);
  }
  const auth = await createAuth({ env: { ...development, DATABASE_URL: 'invalid-url' },
    store: { init() { assert.fail('Development must not access PostgreSQL'); } } });
  assert.equal(auth.development, true);
  await auth.close();
});

test('developer login stays unavailable in Google mode, including development builds', async t => {
  const f = await fixture(t, { AUTH_MODE: 'google', NODE_ENV: 'development' });
  assert.equal((await f.post('/api/auth/development')).status, 404);
  const status = await (await f.request('/api/auth/status')).json();
  assert.equal(status.development, false);
  assert.equal(status.user, null);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: 'cayana_dev_session=' + 'a'.repeat(43) } })).status, 401);
});

test('developer pages and APIs need a session; login rejects cross-site and form requests', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/')).headers.get('location'), '/login');
  assert.equal((await f.request('/api/settings')).status, 401);
  for (const asset of ['/login', '/login.css', '/login.js', '/material.css', '/theme.js']) {
    assert.equal((await f.request(asset)).status, 200, asset + ' is available before sign-in');
  }
  assert.equal((await f.request('/session.js')).headers.get('location'), '/login');
  const status = await (await f.request('/api/auth/status')).json();
  assert.deepEqual(status, { enabled: true, configured: false, development: true, user: null });
  assert.equal((await f.request('/api/auth/development')).status, 405);
  for (const headers of [{ Origin: '' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { Host: 'evil.example' }]) {
    assert.equal((await f.post('/api/auth/development', {}, headers)).status, 403, JSON.stringify(headers));
  }
  assert.equal((await f.post('/api/auth/development', {}, { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  const user = await f.login();
  assert.match(user.response.headers.get('set-cookie'), /^cayana_dev_session=.+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800$/);
  assert.equal(user.settings.storage, 'development');
  assert.equal(user.settings.user.name, 'Developer');
  assert.equal(user.settings.canManageKeys, true);
  assert.equal((await f.request('/', { headers: { Cookie: user.cookie } })).status, 200);
  assert.equal((await f.post('/api/settings', {}, { Cookie: user.cookie })).status, 403);
  const saved = await (await f.post('/api/settings', { agent: { systemPrompt: 'Development prompt.' }, persist: true },
    { Cookie: user.cookie, 'X-Call-Coach-Token': user.settings.csrfToken })).json();
  assert.equal(saved.persisted, true);
  assert.equal(saved.agent.systemPrompt, 'Development prompt.');
  assert.ok(!JSON.stringify(saved).includes('development-test-provider-key'));
  assert.match(await readFile(path.join(f.dir, '.env'), 'utf8'), /AGENT_SYSTEM_PROMPT_BASE64=/);
  assert.equal((await f.request('/api/auth/google/callback')).headers.get('location'), '/login?reason=setup');
});

test('developer sessions rotate, reject forged cookies, and revoke HTTP and audio access on sign-out', async t => {
  const f = await fixture(t);
  const denied = f.socket(); denied.on('error', () => {});
  const [, deniedResponse] = await once(denied, 'unexpected-response'); deniedResponse.resume(); denied.terminate();
  assert.equal(deniedResponse.statusCode, 403);
  const user = await f.login();
  for (const cookie of [user.cookie + '; ' + user.cookie, 'cayana_dev_session=' + 'x'.repeat(43), user.cookie.replace('cayana_dev_session', 'osprey_session')]) {
    assert.equal((await f.request('/api/settings', { headers: { Cookie: cookie } })).status, 401);
  }
  const stream = f.socket(user); await once(stream, 'message');
  const rotatedClosed = once(stream, 'close');
  const rotated = await f.login({ Cookie: user.cookie });
  assert.equal((await rotatedClosed)[0], 1008);
  assert.notEqual(rotated.cookie, user.cookie);
  assert.notEqual(rotated.settings.csrfToken, user.settings.csrfToken);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: user.cookie } })).status, 401);
  const second = f.socket(rotated); await once(second, 'message');
  const closed = once(second, 'close');
  const response = await f.post('/api/auth/logout', {}, { Cookie: rotated.cookie, 'X-Call-Coach-Token': rotated.settings.csrfToken });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await closed)[0], 1008);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: rotated.cookie } })).status, 401);
});

test('developer sessions expire and cannot survive a server restart', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const auth = await createAuth({ env: development });
  const login = await auth.beginDevelopment({ headers: {} });
  const req = { headers: { cookie: login.cookie.split(';')[0] } };
  assert.ok(await auth.authenticate(req));
  t.mock.timers.tick(8 * 60 * 60 * 1000);
  assert.equal(await auth.authenticate(req), null);
  const next = await auth.beginDevelopment({ headers: {} });
  const nextReq = { headers: { cookie: next.cookie.split(';')[0] } };
  await auth.close();
  assert.equal(await auth.authenticate(nextReq), null);
  const restarted = await createAuth({ env: development });
  assert.equal(await restarted.authenticate(nextReq), null);
  await restarted.close();
});
