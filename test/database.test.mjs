import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createPostgresStore } from '../lib/database.mjs';

// Opt in against a real database. Each run creates and removes only its own schema.
test('PostgreSQL migrations, identities, preferences and sessions persist and isolate users', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  const schema = 'test_osprey_' + randomBytes(8).toString('hex');
  const admin = new pg.Pool({ connectionString });
  let store;
  t.after(async () => {
    await store?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  store = createPostgresStore(connectionString, { schema });
  await store.init(); await store.init();
  const alice = await store.upsertUser({ sub: 'google-alice', email: 'alice@gmail.com', name: 'Alice', domain: null });
  const sameAlice = await store.upsertUser({ sub: 'google-alice', email: 'new-alice@gmail.com', name: 'Alice New', domain: null });
  const bob = await store.upsertUser({ sub: 'google-bob', email: 'bob@gmail.com', name: 'Bob', domain: null });
  assert.equal(alice.id, sameAlice.id);
  assert.notEqual(alice.id, bob.id);
  await store.savePreferences(alice.id, { agent: { systemPrompt: 'Alice only' } });
  await store.savePreferences(bob.id, { agent: { systemPrompt: 'Bob only' } });
  const future = new Date(Date.now() + 60_000);
  await store.createSession({ hash: 'alice-session-hash', userId: alice.id, csrfToken: 'alice-csrf', expiresAt: future });
  await store.createSession({ hash: 'bob-session-hash', userId: bob.id, csrfToken: 'bob-csrf', expiresAt: future });
  await store.createSession({ hash: 'expired', userId: bob.id, csrfToken: 'old-csrf', expiresAt: new Date(0) });
  await store.close(); store = createPostgresStore(connectionString, { schema }); await store.init();
  const restored = await store.getSession('alice-session-hash');
  assert.equal(restored.user.email, 'new-alice@gmail.com');
  assert.equal(restored.preferences.agent.systemPrompt, 'Alice only');
  assert.equal((await store.getSession('bob-session-hash')).preferences.agent.systemPrompt, 'Bob only');
  assert.equal(await store.getSession('expired'), null);
  await store.beginLogin({ hash: 'attempt-hash', stateHash: 'state-hash', nonce: 'nonce', verifier: 'pkce', expiresAt: future });
  assert.equal(await store.consumeLogin('attempt-hash', 'wrong-state'), null);
  const attempts = await Promise.all([store.consumeLogin('attempt-hash', 'state-hash'), store.consumeLogin('attempt-hash', 'state-hash')]);
  assert.equal(attempts.filter(Boolean).length, 1);
  assert.deepEqual(attempts.find(Boolean), { nonce: 'nonce', verifier: 'pkce' });
  await store.deleteSession('alice-session-hash');
  assert.equal(await store.getSession('alice-session-hash'), null);
  assert.ok(await store.getSession('bob-session-hash'));
  await store.cleanup();
  const stale = await admin.query(`SELECT token_hash FROM ${schema}.sessions WHERE expires_at<=now()`);
  assert.equal(stale.rowCount, 0);
});
