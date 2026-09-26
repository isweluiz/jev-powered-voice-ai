import test from 'node:test';
import assert from 'node:assert/strict';
import { startOverviewIntro } from '../public/overview-intro.js';
import { overviewNumbers, sampleTrend, SAMPLE_OUTCOMES } from '../public/demo-data.js';

function clock(reduced = false) {
  let nextId = 0;
  const frames = new Map(), listeners = new Set();
  return {
    frames, listeners,
    options: {
      now: () => 100,
      requestFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
      cancelFrame: id => frames.delete(id),
      motion: { matches: reduced, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) },
    },
    step(elapsed) {
      const scheduled = [...frames.values()];
      frames.clear();
      scheduled.forEach(fn => fn(100 + elapsed));
    },
    reduce() { [...listeners].forEach(fn => fn({ matches: true })); },
  };
}

test('one frame clock drives all formatted Overview values to their exact targets in 1400 ms', () => {
  const timer = clock(), progress = [], values = [], total = sampleTrend('monthly').total;
  startOverviewIntro(p => { progress.push(p); values.push(overviewNumbers(p, total)); }, timer.options);
  assert.equal(timer.frames.size, 1);
  assert.deepEqual(values[0], { conversations: '0', average: '0m 00s', rate: '0.0%', handoffs: '0', resolved: '0', trend: '0' });
  timer.step(700);
  assert.equal(progress.at(-1), .875);
  assert.equal(values.at(-1).conversations, '1,124');
  assert.equal(values.at(-1).average, '3m 14s');
  assert.equal(values.at(-1).rate, '63.4%');
  assert.equal(timer.frames.size, 1);
  timer.step(1400);
  assert.equal(progress.at(-1), 1);
  assert.deepEqual(values.at(-1), { conversations: '1,284', average: '3m 42s', rate: '72.4%', handoffs: '86', resolved: '930', trend: '5,301' });
  assert.equal(timer.frames.size, 0);
  assert.equal(timer.listeners.size, 0);
  timer.step(2000);
  assert.equal(values.length, 3);
});

test('reduced motion skips the loop; enabling it mid-intro cancels and finishes immediately', () => {
  const timer = clock(true), progress = [];
  startOverviewIntro(p => progress.push(p), timer.options);
  assert.deepEqual(progress, [1]);
  assert.equal(timer.frames.size, 0);
  const moving = clock(), movingProgress = [];
  startOverviewIntro(p => movingProgress.push(p), moving.options);
  moving.step(250);
  moving.reduce();
  assert.equal(movingProgress.at(-1), 1);
  assert.equal(moving.frames.size, 0);
  assert.equal(moving.listeners.size, 0);
  moving.step(1400);
  assert.equal(movingProgress.length, 3);
});

test('unmount cancels a queued frame and a new mount starts a fresh intro', () => {
  const timer = clock(), progress = [];
  const cancel = startOverviewIntro(p => progress.push(p), timer.options);
  const lateFrame = [...timer.frames.values()][0];
  cancel(); cancel();
  lateFrame(800);
  assert.deepEqual(progress, [0]);
  assert.equal(timer.frames.size, 0);
  assert.equal(timer.listeners.size, 0);
  startOverviewIntro(p => progress.push(p), timer.options);
  timer.step(1600);
  assert.deepEqual(progress, [0, 0, 1]);
});

test('sample chart totals and outcome series remain consistent with the displayed analytics', () => {
  for (const period of ['weekly', 'monthly', 'yearly']) {
    const trend = sampleTrend(period);
    assert.equal(trend.total, trend.columns.reduce((sum, col) => sum + col.voice + col.text, 0));
    assert.ok(trend.columns.every(col => col.textLevel >= col.voiceLevel && col.textLevel <= 22));
  }
  assert.equal(SAMPLE_OUTCOMES.reduce((sum, item) => sum + item.total, 0), 1284);
  assert.equal(SAMPLE_OUTCOMES.reduce((sum, item) => sum + item.resolved, 0), 930);
  assert.ok(SAMPLE_OUTCOMES.every(item => item.resolved <= item.total));
  assert.equal(overviewNumbers(60 / 222, 0).average, '1m 00s');
});
