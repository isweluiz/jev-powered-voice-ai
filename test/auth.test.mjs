import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { createApp } from '../server.mjs';
import { hashToken, publicOrigin } from '../lib/auth.mjs';

const canonical = 'https://osprey.example';
const key = 'test-only-provider-key';
const cookiePair = response => response.headers.getSetCookie()[0].split(';')[0];
async function listen(server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
// Deliberately injected through createApp; no fake identity path exists in production.
function memoryStore() {
  const users = new Map(), preferences = new Map(), sessions = new Map(), transactions = new Map(), agents = new Map();
  return {
    users, preferences, sessions, transactions,
    async init() {}, async close() {}, async cleanup() {},
    async beginLogin(value) { transactions.set(value.hash, value); },
    async consumeLogin(hash, stateHash) {
      const value = transactions.get(hash);
      if (!value || value.stateHash !== stateHash || value.expiresAt <= new Date()) return null;
      transactions.delete(hash); return value;
    },
    async upsertUser(profile) {
      const value = { id: users.get(profile.sub)?.id || randomUUID(), ...profile };
      users.set(profile.sub, value); return value;
    },
    async createSession(value) { sessions.set(value.hash, value); },
    async getSession(hash) {
      const value = sessions.get(hash);
      if (!value || value.expiresAt <= new Date()) return null;
      return { user: [...users.values()].find(u => u.id === value.userId), csrfToken: value.csrfToken,
        expiresAt: value.expiresAt, preferences: structuredClone(preferences.get(value.userId) || {}) };
    },
    async deleteSession(hash) { sessions.delete(hash); },
    async savePreferences(id, value) { preferences.set(id, structuredClone(value)); },
    async listAgents(owner) { return [...agents.values()].filter(row => row.owner === owner).map(row => row.agent); },
    async getAgent(owner, id) { const row = agents.get(id); return row?.owner === owner ? structuredClone(row.agent) : null; },
    async saveAgent(owner, agent, { create = false } = {}) {
      if (!create && agents.get(agent.id)?.owner !== owner) return null;
      agents.set(agent.id, { owner, agent: structuredClone(agent) }); return agent;
    },
  };
}
async function fixture(t, env = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'osprey-auth-'));
  const store = memoryStore(), attempts = new Map(), calls = [];
  let alterProfile = value => value;
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks)) });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'A private reply.' }] }] }));
  });
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', ws => ws.send(JSON.stringify({ type: 'SessionOpened' })));
  const upstreamUrl = await listen(upstream);
  const google = {
    authorizationURL(value) { attempts.set(value.verifier, value); return `https://accounts.google.com/o/oauth2/v2/auth?state=${value.state}`; },
    async verifyCode({ code, verifier }) {
      assert.ok(attempts.has(verifier), 'correct PKCE verifier reaches exchange');
      return alterProfile({ sub: 'google-' + code, email: code + '@gmail.com', name: code,
        email_verified: true, nonce: attempts.get(verifier).nonce });
    },
  };
  const app = await createApp({ env: { AUTH_MODE: 'google', APP_BASE_URL: canonical, AUTH_ALLOW_ANY_GOOGLE_ACCOUNT: 'true',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', AUTH_ADMIN_EMAILS: 'admin@gmail.com',
    BW_STT_API_KEY: key, OPENAI_API_KEY: key, ...env }, envPath: path.join(dir, '.env'), authStore: store, google,
    endpoints: { agent: upstreamUrl + '/responses', stt: upstreamUrl.replace('http:', 'ws:') + '/listen' } });
  const origin = await listen(app.server);
  const request = (route, options = {}) => new Promise((resolve, reject) => {
    const req = http.request(origin + route, { method: options.method || 'GET', headers: { Host: 'osprey.example', ...options.headers } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const headers = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
      });
    });
    req.on('error', reject); req.end(options.body);
  });
  async function begin() {
    const response = await request('/api/auth/google');
    assert.equal(response.status, 303);
    return { response, cookie: cookiePair(response), state: new URL(response.headers.get('location')).searchParams.get('state') };
  }
  async function finish(start, code, cookie = start.cookie) {
    return request(`/api/auth/google/callback?code=${code}&state=${start.state}`, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } });
  }
  async function login(code) {
    const start = await begin(); const response = await finish(start, code);
    assert.equal(response.headers.get('location'), '/');
    const cookie = cookiePair(response);
    const settings = await (await request('/api/settings', { headers: { Cookie: cookie } })).json();
    return { cookie, settings, response, start };
  }
  function post(user, route, body, headers = {}) {
    return request(route, { method: 'POST', headers: { Cookie: user.cookie, Origin: canonical,
      'X-Call-Coach-Token': user.settings.csrfToken, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  }
  function socket(user, overrides = {}) {
    return new WebSocket(origin.replace('http:', 'ws:') + '/api/stt', ['call-coach', `csrf.${user.settings.csrfToken}`],
      { origin: canonical, headers: { Host: 'osprey.example', Cookie: user.cookie }, ...overrides });
  }
  t.after(async () => {
    await app.close(); for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return { app, store, request, begin, finish, login, post, socket, calls, alterProfile: fn => { alterProfile = fn; } };
}

test('Google mode locks pages, APIs and audio before login; setup stays closed without credentials', async t => {
  const f = await fixture(t, { GOOGLE_CLIENT_SECRET: '' });
  assert.equal((await f.request('/')).headers.get('location'), '/login');
  assert.equal((await f.request('/login')).status, 200);
  assert.equal((await f.request('/login.js')).status, 200);
  for (const route of ['/api/settings', '/api/health', '/api/reply', '/api/evaluate', '/api/tts']) assert.equal((await f.request(route)).status, 401);
  assert.equal((await f.request('/api/auth/status')).status, 200);
  assert.equal((await f.request('/api/auth/google')).headers.get('location'), '/login?reason=setup');
  assert.equal((await f.request('/login', { headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await f.request('/api/auth/google', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const ws = f.socket({ cookie: '', settings: { csrfToken: 'fake' } });
  ws.on('error', () => {});
  const [, response] = await once(ws, 'unexpected-response'); response.resume(); ws.terminate();
  assert.equal(response.statusCode, 403);
});

test('login binds state to the browser, consumes codes once, and issues private expiring sessions', async t => {
  const f = await fixture(t);
  const start = await f.begin();
  const transactionCookie = start.response.headers.getSetCookie()[0];
  assert.match(transactionCookie, /^__Host-osprey_oauth=/);
  for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/', 'Max-Age=600']) assert.ok(transactionCookie.includes(attribute));
  assert.equal((await f.finish({ ...start, state: 'wrong' }, 'alice')).headers.get('location'), '/login?reason=expired');
  assert.equal((await f.finish(start, 'alice', '')).headers.get('location'), '/login?reason=expired');
  const response = await f.finish(start, 'alice');
  assert.equal(response.headers.get('location'), '/');
  assert.match(response.headers.getSetCookie()[0], /^__Host-osprey_session=.*Max-Age=28800; Secure$/);
  const rawToken = cookiePair(response).split('=')[1];
  assert.equal(f.store.sessions.has(rawToken), false);
  assert.equal(f.store.sessions.has(hashToken(rawToken)), true);
  assert.equal((await f.finish(start, 'alice')).headers.get('location'), '/login?reason=expired');
  const authStatus = await (await f.request('/api/auth/status', { headers: { Cookie: cookiePair(response) } })).json();
  assert.equal(authStatus.user.email, 'alice@gmail.com');
  assert.equal(authStatus.user.role, 'member');
  assert.equal(Object.hasOwn(authStatus, 'csrfToken'), false);
});

test('expired attempts, invalid nonces and unverified Google identities cannot create sessions', async t => {
  const f = await fixture(t);
  const expired = await f.begin();
  for (const value of f.store.transactions.values()) value.expiresAt = new Date(0);
  assert.equal((await f.finish(expired, 'alice')).headers.get('location'), '/login?reason=expired');
  for (const mutate of [p => ({ ...p, nonce: 'invalid' }), p => ({ ...p, email_verified: false }), p => ({ ...p, sub: '' })]) {
    f.alterProfile(mutate);
    assert.equal((await f.finish(await f.begin(), 'alice')).headers.get('location'), '/login?reason=failed');
  }
  assert.equal(f.store.sessions.size, 0);
});

test('each Google account owns its preferences and CSRF token; shared keys require an explicit admin', async t => {
  const f = await fixture(t);
  const alice = await f.login('alice'), bob = await f.login('bob'), admin = await f.login('admin');
  assert.notEqual(alice.settings.user.id, bob.settings.user.id);
  assert.notEqual(alice.settings.csrfToken, bob.settings.csrfToken);
  assert.equal(alice.settings.canManageKeys, false);
  assert.equal(admin.settings.canManageKeys, true);
  assert.equal((await f.post(alice, '/api/settings', { keys: { openai: 'changed-key' } })).status, 403);
  assert.equal((await f.post(alice, '/api/settings', {}, { 'X-Call-Coach-Token': bob.settings.csrfToken })).status, 403);
  assert.equal((await f.post(alice, '/api/settings', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.post(alice, '/api/settings', { agent: { systemPrompt: 'Alice private sales prompt.' }, voice: 'aura-2-draco-en', sttProvider: 'browser', userId: bob.settings.user.id })).status, 200);
  assert.equal((await f.post(bob, '/api/settings', { agent: { systemPrompt: 'Bob private support prompt.' } })).status, 200);
  const anotherAliceSession = await f.login('alice');
  assert.equal(anotherAliceSession.settings.agent.systemPrompt, 'Alice private sales prompt.');
  assert.equal(anotherAliceSession.settings.voice, 'aura-2-draco-en');
  assert.equal((await f.post(alice, '/api/reply', { turns: [{ speaker: 'customer', text: 'Help me' }] })).status, 200);
  assert.equal((await f.post(bob, '/api/reply', { turns: [{ speaker: 'customer', text: 'Help me too' }] })).status, 200);
  assert.match(JSON.stringify(f.calls[0].body), /Alice private sales prompt/);
  assert.ok(!JSON.stringify(f.calls[0].body).includes('Bob private'));
  assert.match(JSON.stringify(f.calls[1].body), /Bob private support prompt/);
  assert.ok(!JSON.stringify(f.calls[1].body).includes('Alice private'));
  assert.equal((await f.post(admin, '/api/settings', { keys: { openai: 'admin-changed-key' } })).status, 200);
  const safe = await (await f.request('/api/settings', { headers: { Cookie: bob.cookie } })).text();
  assert.ok(!safe.includes('admin-changed-key'));
  assert.ok(!safe.includes('Alice private'));
});

test('sign-out revokes only that session and closes its authenticated audio stream', async t => {
  const f = await fixture(t), alice = await f.login('alice'), bob = await f.login('bob');
  const ws = f.socket(alice);
  await once(ws, 'message');
  const denied = f.socket({ ...bob, settings: alice.settings });
  denied.on('error', () => {});
  const [, deniedResponse] = await once(denied, 'unexpected-response'); deniedResponse.resume(); denied.terminate();
  assert.equal(deniedResponse.statusCode, 403);
  const closed = once(ws, 'close');
  const response = await f.post(alice, '/api/auth/logout', {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await closed)[0], 1008);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: alice.cookie } })).status, 401);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: bob.cookie } })).status, 200);
  const value = f.store.sessions.get(hashToken(bob.cookie.split('=')[1])); value.expiresAt = new Date(0);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: bob.cookie } })).status, 401);
});

test('a new sign-in rotates the old session; forged and duplicate session cookies are rejected', async t => {
  const f = await fixture(t), alice = await f.login('alice');
  const start = await f.begin();
  const rotated = await f.finish(start, 'alice', `${start.cookie}; ${alice.cookie}`);
  assert.notEqual(cookiePair(rotated), alice.cookie);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: alice.cookie } })).status, 401);
  const cookie = cookiePair(rotated);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: `${cookie}; ${cookie}` } })).status, 401);
  assert.equal((await f.request('/api/settings', { headers: { Cookie: '__Host-osprey_session=' + 'x'.repeat(43) } })).status, 401);
});

test('optional domain policy uses the verified hosted-domain claim, not an email suffix', async t => {
  const f = await fixture(t, { AUTH_ALLOW_ANY_GOOGLE_ACCOUNT: 'false', AUTH_ALLOWED_DOMAINS: 'example.com' });
  f.alterProfile(p => ({ ...p, email: 'alice@example.com' }));
  assert.equal((await f.finish(await f.begin(), 'alice')).headers.get('location'), '/login?reason=denied');
  f.alterProfile(p => ({ ...p, email: 'alice@example.com', hd: 'example.com' }));
  assert.equal((await f.finish(await f.begin(), 'alice')).headers.get('location'), '/');
});

test('deployment URL requires HTTPS except localhost, and local mode cannot bind publicly', async () => {
  assert.equal(publicOrigin('http://127.0.0.1:3456'), 'http://127.0.0.1:3456');
  assert.equal(publicOrigin('https://osprey.example/'), canonical);
  for (const value of ['http://osprey.example', 'https://user:pass@osprey.example', 'https://osprey.example/path', 'https://osprey.example?x=1']) assert.throws(() => publicOrigin(value));
  await assert.rejects(createApp({ env: { AUTH_MODE: 'local', HOST: '0.0.0.0' }, envPath: '/nonexistent-osprey-env' }), /Local mode cannot/);
});

test('saved web agents are owned by their account and cannot select another user’s prompt', async t => {
  const f = await fixture(t), alice = await f.login('alice'), bob = await f.login('bob');
  assert.equal((await f.request('/api/agents')).status, 401);
  assert.equal((await f.post(alice, '/api/agents', { name: 'Alice service desk', templateId: 'it-support' }, { 'X-Call-Coach-Token': '' })).status, 403);
  const created = await f.post(alice, '/api/agents', { name: 'Alice service desk', templateId: 'it-support', company: 'Alice Labs', userId: bob.settings.user.id });
  assert.equal(created.status, 201);
  const { agent } = await created.json();
  assert.equal((await f.request('/api/agents', { headers: { Cookie: bob.cookie } }).then(r => r.json())).agents.length, 0);
  const foreign = '/api/agents/' + agent.id;
  assert.equal((await f.request(foreign, { headers: { Cookie: bob.cookie } })).status, 404);
  assert.equal((await f.post(bob, foreign, { name: 'Hijacked' })).status, 404);
  assert.equal((await f.request('/api/settings?agentId=' + agent.id, { headers: { Cookie: bob.cookie } })).status, 404);
  assert.equal((await f.post(bob, '/api/reply', { agentId: agent.id, turns: [{ speaker: 'customer', text: 'Help me' }] })).status, 404);
  assert.equal(f.calls.length, 0);
  const saved = await f.post(alice, '/api/settings', { agentId: agent.id, agent: { systemPrompt: 'Private IT specialist for Alice.' }, voice: 'aura-2-draco-en' });
  assert.equal(saved.status, 200);
  const prefs = await saved.json();
  assert.equal(prefs.storage, 'agent');
  assert.equal(prefs.voice, 'aura-2-draco-en');
  assert.equal(prefs.workspaceAgent.templateId, 'it-support');
  assert.equal((await f.request(foreign, { headers: { Cookie: alice.cookie } }).then(r => r.json())).agent.systemPrompt, 'Private IT specialist for Alice.');
  assert.equal((await f.request('/api/settings', { headers: { Cookie: alice.cookie } }).then(r => r.json())).agent.systemPrompt, alice.settings.agent.systemPrompt);
  assert.equal((await f.post(alice, '/api/reply', { agentId: agent.id, turns: [{ speaker: 'customer', text: 'My laptop cannot connect' }] })).status, 200);
  assert.match(f.calls[0].body.instructions, /Private IT specialist for Alice/);
  assert.equal((await f.post(alice, '/api/agents', { name: 'Unknown sector', templateId: 'untrusted-template' })).status, 400);
});
