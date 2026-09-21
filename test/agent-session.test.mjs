import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../public/agent-session.js', import.meta.url), 'utf8')).replace("import { apiPost } from './settings.js';", 'const apiPost = (...args) => globalThis.testAgentPost(...args);');
const { AgentSession } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('voice turn drains STT, generates and speaks once, and resumes only after playback', async () => {
  const actions = []; let finishAudio;
  const turns = [{ speaker: 'customer', text: 'We need a CRM' }];
  globalThis.testAgentPost = async (_path, payload) => {
    actions.push('generate'); assert.equal(payload.turns[0].text, 'We need a CRM for twenty people');
    assert.equal(payload.guidance.action, 'ask_discovery_question');
    return { ok: true, json: async () => ({ text: 'What is your timeline?' }) };
  };
  const voice = { finished: new Promise(resolve => { finishAudio = resolve; }), speak: async () => actions.push('speak'), stop() {} };
  const session = new AgentSession({ getTurns: () => turns, startInput: async () => actions.push('listen'),
    getGuidance: async snapshot => { actions.push('evaluate'); assert.equal(snapshot[0].text, 'We need a CRM for twenty people'); return { status: 'act', action: 'ask_discovery_question' }; },
    stopInput: async () => { actions.push('drain'); turns[0].text += ' for twenty people'; }, voice,
    onReply: text => { actions.push('reply'); turns.push({ speaker: 'rep', text }); }, onState() {}, onError: assert.fail, canSpeak: () => true });
  session.active = true;
  const reply = session.reply();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actions, ['drain', 'evaluate', 'generate', 'reply', 'speak']);
  finishAudio(true); await reply;
  assert.deepEqual(actions, ['drain', 'evaluate', 'generate', 'reply', 'speak', 'listen']);
  assert.equal(session.busy, false);
  delete globalThis.testAgentPost;
});

test('ending an agent session discards a late reply and never restarts the microphone', async () => {
  let resolveReply, requested; const actions = [];
  const requestStarted = new Promise(resolve => { requested = resolve; });
  globalThis.testAgentPost = () => new Promise(resolve => { resolveReply = resolve; requested(); });
  const session = new AgentSession({ getTurns: () => [{ speaker: 'customer', text: 'Hello' }], startInput: async () => actions.push('listen'),
    stopInput: async () => {}, voice: { stop() {}, speak: async () => actions.push('speak') },
    onReply: () => actions.push('reply'), onState() {}, onError: assert.fail, canSpeak: () => true });
  session.active = true;
  const pending = session.reply(); await requestStarted;
  await session.end();
  resolveReply({ ok: true, json: async () => ({ text: 'Late reply' }) }); await pending;
  assert.deepEqual(actions, []); assert.equal(session.active, false);
  delete globalThis.testAgentPost;
});

test('ending while Jev is evaluating prevents model generation from starting', async () => {
  let releaseGuidance, evaluating;
  const started = new Promise(resolve => { evaluating = resolve; });
  globalThis.testAgentPost = () => assert.fail('A cancelled turn must not call OpenAI');
  const session = new AgentSession({ getTurns: () => [{ speaker: 'customer', text: 'Hello' }],
    getGuidance: () => new Promise(resolve => { releaseGuidance = resolve; evaluating(); }),
    startInput() {}, stopInput: async () => {}, voice: { stop() {} },
    onReply: assert.fail, onState() {}, onError: assert.fail, canSpeak: () => false });
  const pending = session.reply(); await started; await session.end(); releaseGuidance(null); await pending;
  assert.equal(session.busy, false); delete globalThis.testAgentPost;
});
