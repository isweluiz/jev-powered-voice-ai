import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../public/jev-client.js', import.meta.url), 'utf8')).replace("import { apiPost } from './settings.js';", 'const apiPost = (...args) => globalThis.testJevPost(...args);');
const { JevClient } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('gauge and agent share an evaluation, while a changed final transcript gets fresh guidance', async () => {
  const calls = [], completions = [];
  globalThis.testJevPost = (_path, payload) => { calls.push(payload); return new Promise(resolve => completions.push(resolve)); };
  const jev = new JevClient();
  try {
    const turns = [{ speaker: 'customer', text: 'We need a CRM' }];
    const gauge = jev.evaluate(turns), agent = jev.evaluate(turns);
    assert.equal(calls.length, 1);
    completions.shift()({ ok: true, json: async () => ({ answers: 'first' }) });
    assert.deepEqual(await gauge, await agent);
    turns[0].text += ' for twenty people';
    const final = jev.evaluate(turns);
    assert.equal(calls.length, 2); assert.match(calls[1].turns[0].text, /twenty people/);
    completions.shift()({ ok: true, json: async () => ({ answers: 'final' }) });
    assert.deepEqual(await final, { answers: 'final' });
  } finally { jev.clear(); delete globalThis.testJevPost; }
});

test('cancelling a reply waiter does not substitute old guidance or cancel the gauge', async () => {
  let complete;
  globalThis.testJevPost = () => new Promise(resolve => { complete = resolve; });
  const jev = new JevClient(); const controller = new AbortController();
  try {
    const turns = [{ speaker: 'customer', text: 'When can we book a demo?' }];
    const gauge = jev.evaluate(turns), agent = jev.evaluate(turns, { signal: controller.signal });
    controller.abort(); await assert.rejects(agent, { name: 'AbortError' });
    complete({ ok: true, json: async () => ({ answers: 'current turn' }) });
    assert.deepEqual(await gauge, { answers: 'current turn' });
  } finally { jev.clear(); delete globalThis.testJevPost; }
});
