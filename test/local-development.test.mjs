import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
import { loadEnvironment, startupEnvironment } from '../lib/runtime.mjs';
import { TEMPLATES } from '../public/templates.js';

test('local startup is explicit, preserves configured Google startup, and refuses production or conflicting flags', () => {
  const configured = { AUTH_MODE: 'google', DATABASE_URL: 'invalid-url' };
  assert.equal(startupEnvironment(configured).AUTH_MODE, 'google');
  assert.equal(startupEnvironment(configured, ['--dev']).AUTH_MODE, 'development');
  assert.equal(startupEnvironment(configured, ['--local']).AUTH_MODE, 'local');
  assert.equal(configured.AUTH_MODE, 'google');
  for (const flag of ['--local', '--dev']) {
    for (const NODE_ENV of ['production', 'test']) {
      assert.throws(() => startupEnvironment({ ...configured, NODE_ENV }, [flag]), /requires NODE_ENV=development/);
    }
  }
  assert.throws(() => startupEnvironment(configured, ['--local', '--dev']), /Choose either/);
});

test('no-login startup rejects network exposure even when overriding a Google configuration', async () => {
  for (const override of [{ HOST: '0.0.0.0' }, { HOST: '::' }, { APP_BASE_URL: 'https://cayana.example' }]) {
    const env = startupEnvironment({ AUTH_MODE: 'google', ...override }, ['--local']);
    await assert.rejects(createApp({ env, envPath: '/nonexistent-cayana-local-test-env' }), /Local mode/);
  }
});

test('local startup ignores database credentials, opens the workspace without cookies, and saves agents across restarts', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cayana-local-'));
  const envPath = path.join(dir, '.env');
  const savedEnv = 'AUTH_MODE=google\nDATABASE_URL=invalid-url\n';
  await writeFile(envPath, savedEnv, { mode: 0o600 });
  let app;
  t.after(async () => { if (app) await app.close(); await rm(dir, { recursive: true, force: true }); });
  const start = async () => {
    const env = startupEnvironment(await loadEnvironment(envPath, {}), ['--local']);
    app = await createApp({ env, envPath });
    app.server.listen(0, app.host);
    await once(app.server, 'listening');
    return `http://127.0.0.1:${app.server.address().port}`;
  };
  let origin = await start();
  for (const route of ['/', '/talk', '/agents', '/templates', '/agents/new']) {
    const page = await fetch(origin + route, { redirect: 'manual' });
    assert.equal(page.status, 200, route);
    assert.equal(page.headers.get('set-cookie'), null);
  }
  for (const route of ['/login', '/login.html']) {
    const page = await fetch(origin + route, { redirect: 'manual' });
    assert.equal(page.status, 303);
    assert.equal(page.headers.get('location'), '/');
  }
  assert.deepEqual(await fetch(origin + '/api/auth/status').then(r => r.json()),
    { enabled: false, configured: false, development: false, user: null });
  const settings = await fetch(origin + '/api/settings').then(r => r.json());
  assert.equal(settings.storage, 'local');
  assert.equal(settings.user, null);
  assert.equal(settings.canManageKeys, true);
  const initialAgents = await fetch(origin + '/api/agents').then(r => r.json());
  assert.equal(initialAgents.agents.length, TEMPLATES.length);
  for (const starter of initialAgents.agents) {
    const config = await fetch(origin + '/api/settings?agentId=' + starter.id).then(r => r.json());
    assert.equal(config.workspaceAgent.templateId, starter.templateId);
    assert.equal(config.workspaceAgent.name, starter.name);
    assert.equal(config.voice, settings.voice);
    assert.equal(config.sttProvider, settings.sttProvider);
    assert.equal(config.agent.model, settings.agent.model);
  }
  const body = JSON.stringify({ name: 'Local test agent', templateId: 'custom', systemPrompt: 'Ask one question at a time.' });
  const post = headers => fetch(origin + '/api/agents', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body });
  assert.equal((await post({})).status, 403, 'Local writes still require a CSRF token');
  assert.equal((await post({ 'X-Call-Coach-Token': settings.csrfToken, Origin: 'https://evil.example' })).status, 403);
  const response = await post({ 'X-Call-Coach-Token': settings.csrfToken });
  assert.equal(response.status, 201);
  const { agent } = await response.json();
  await app.close(); app = null;
  origin = await start();
  const { agents } = await fetch(origin + '/api/agents').then(r => r.json());
  assert.equal(agents.length, TEMPLATES.length + 1);
  assert.equal(agents.find(saved => saved.id === agent.id).name, 'Local test agent');
  assert.ok(initialAgents.agents.every(starter => agents.some(saved => saved.id === starter.id)));
  assert.equal(await readFile(envPath, 'utf8'), savedEnv, 'Starting locally never rewrites .env');
});
