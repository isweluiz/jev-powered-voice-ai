import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_LOGS, SAMPLE_AGENTS, selectLogs, summarizeLogs } from '../public/demo-data.js';
import { getTemplate } from '../public/templates.js';

test('sample logs map to working sector templates and metrics are derived from the sample dataset', () => {
  assert.equal(SAMPLE_LOGS.length, 8);
  assert.ok(SAMPLE_LOGS.every(log => log.sample && getTemplate(log.agent)));
  assert.ok(SAMPLE_LOGS.every(log => SAMPLE_AGENTS.find(agent => agent.id === log.agent)?.turns.length >= log.n));
  assert.deepEqual(summarizeLogs([]), { total: 0, resolved: 0, rate: 0, handoffs: 0, average: 0 });
  const stats = summarizeLogs(SAMPLE_LOGS);
  assert.equal(stats.total, 8);
  assert.equal(stats.resolved, 4);
  assert.equal(stats.handoffs, 2);
  assert.equal(stats.rate, 50);
});

test('sample conversation search matches caller, agent, ID and outcome; durations sort numerically', () => {
  for (const term of [' MAYA ', 'C-1048', 'qualified']) assert.equal(selectLogs(SAMPLE_LOGS, term)[0].id, 'C-1048');
  assert.equal(selectLogs(SAMPLE_LOGS, 'IT service desk').length, 2);
  assert.deepEqual(selectLogs(SAMPLE_LOGS, 'not-a-caller'), []);
  const logs = [{ id: 'long', dur: '10m 00s' }, { id: 'short', dur: '2m 59s' }, { id: 'tiny', dur: '0m 58s' }];
  assert.deepEqual(selectLogs(logs, '', 'dur').map(log => log.id), ['tiny', 'short', 'long']);
  assert.deepEqual(selectLogs(logs, '', 'dur', -1).map(log => log.id), ['long', 'short', 'tiny']);
  assert.deepEqual(logs.map(log => log.id), ['long', 'short', 'tiny']);
});
