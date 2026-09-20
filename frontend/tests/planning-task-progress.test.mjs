import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginPlanningTaskProgress, getPlanningProgress, subscribePlanningProgress,
} from '../lib/planning-task-progress.ts';
import { enqueuePlanningTask, getPlanningTask } from '../lib/story-planning-background.ts';

test('background thinking and request ID remain available after the page observer leaves and returns', async () => {
  const key = `task-progress:${crypto.randomUUID()}`;
  const run = beginPlanningTaskProgress(key);
  let observations = 0;
  const unsubscribe = subscribePlanningProgress(() => { observations += 1; });
  run.onEvent({ type: 'progress', stage: 'thinking', message: '正在规划', request_id: 'request-10' });
  assert.equal(observations, 1);
  unsubscribe();
  run.onEvent({ type: 'model_thinking', delta: '正在衔接上一集留下的问题。' });
  assert.equal(observations, 1);
  const resumed = getPlanningProgress(key);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.requestId, 'request-10');
  assert.equal(resumed.thinking, '正在衔接上一集留下的问题。');
  const subscribeAgain = subscribePlanningProgress(() => { observations += 1; });
  run.finish('completed');
  assert.equal(observations, 2);
  assert.equal(getPlanningProgress(key).status, 'completed');
  subscribeAgain();
});

test('a new task generation supersedes old callbacks; another project retains its own snapshot', () => {
  const firstKey = `task-progress:${crypto.randomUUID()}`;
  const secondKey = `task-progress:${crypto.randomUUID()}`;
  const old = beginPlanningTaskProgress(firstKey);
  const other = beginPlanningTaskProgress(secondKey);
  other.onEvent({ type: 'model_thinking', delta: '另一个项目' });
  const current = beginPlanningTaskProgress(firstKey);
  current.onEvent({ type: 'model_thinking', delta: '重试后的进度' });
  old.onEvent({ type: 'model_thinking', delta: '旧请求迟到的数据' });
  assert.equal(getPlanningProgress(firstKey).thinking, '重试后的进度');
  assert.equal(getPlanningProgress(secondKey).thinking, '另一个项目');
  current.finish('completed'); other.finish('completed');
});

test('explicit cancellation still ends retained progress and completed history stays bounded', () => {
  const key = `task-progress:${crypto.randomUUID()}`;
  const controller = new AbortController();
  const run = beginPlanningTaskProgress(key, controller.signal);
  controller.abort();
  run.onEvent({ type: 'model_thinking', delta: '迟到的内容' });
  assert.equal(getPlanningProgress(key).status, 'paused');
  assert.equal(getPlanningProgress(key).thinking, undefined);
  for (let index = 0; index < 42; index += 1) beginPlanningTaskProgress(`bounded:${crypto.randomUUID()}`).finish('completed');
  assert.equal(getPlanningProgress(key), null);
});

test('returning to an active task uses the same promise and failure remains discoverable without an observer', async () => {
  const projectId = `project:${crypto.randomUUID()}`;
  const key = `episode-roadmap-all:${projectId}`;
  let reject;
  let calls = 0;
  const task = enqueuePlanningTask({ key, projectId, kind: 'episode_roadmap', run: () => {
    calls += 1;
    return new Promise((resolve, fail) => { reject = fail; });
  } });
  const rejected = assert.rejects(task.promise, /第10集暂时失败/);
  const restored = enqueuePlanningTask({ key, projectId, kind: 'episode_roadmap', run: async () => {
    calls += 1; return 'must not run';
  } });
  assert.equal(restored.promise, task.promise);
  assert.equal(getPlanningTask(key).status, 'running');
  reject(new Error('第10集暂时失败'));
  await rejected;
  assert.equal(calls, 1);
  assert.equal(getPlanningTask(key).status, 'failed');
  assert.match(getPlanningTask(key).error, /第10集/);
});
