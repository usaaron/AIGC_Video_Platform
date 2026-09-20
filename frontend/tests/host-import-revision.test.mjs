import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../components/host-import-panel.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const receipt = { status: 'completed', targetProjectId: 'host-p', importedEpisodes: 0, updatedEpisodes: 1,
  importedAssets: 0, updatedAssets: 0, preservedAssets: 0, importedShots: 2, updatedShots: 0,
  revisionSummary: { episodeNumbers: [1], preservedShots: 2, renewedShots: 2 } };

function panel({ conflict = false, result = null, outcome = receipt, updatedAt = '' } = {}) {
  const material = { episodes: [{ sourceEpisodeId: 'episode-1', episodeNumber: 1, title: '第一集', content: '修订后的正文' }], assets: [], warnings: [] };
  const states = [true, [{ id: 'host-p', name: '当前项目' }], 'host-p', material, ['episode-1'], true, true, false, false, '', result, conflict];
  const requests = [], notifications = [];
  let index = 0;
  const context = {
    Error,
    exports: {},
    require(name) {
      if (name === 'react') return { useEffect() {}, useRef: value => ({ current: value }), useState() { const slot = index++; return [states[slot], value => { states[slot] = value; }]; } };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === '@/lib/host-session') return { hostProjectId: () => 'host-p' };
      if (name === '@/lib/host-navigation') return { isHostEmbedded: () => true, isHostScriptWorkflow: () => true, notifyHost: (...args) => notifications.push(args) };
      if (name === '@/lib/use-host-script-workflow') return { useHostScriptWorkflow: () => true };
      if (name === '@/components/host-return-link') return { HostWorkspaceLink: ({ children, view }) => createElement('a', { href: `/${view}` }, children) };
      if (name === '@/lib/host-import') return { HostImportError: Error, importMaterial: async (...args) => { requests.push(args); return await outcome; } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  const element = context.exports.HostImportPanel({ project: { id: 'p', updatedAt }, onTarget() {}, onClose() {} });
  return { element, requests, notifications, states, html: renderToStaticMarkup(element) };
}
function content(element) {
  if (typeof element === 'string') return element;
  if (Array.isArray(element)) return element.map(content).join('');
  return element?.props ? content(element.props.children) : '';
}
function button(element, label) {
  if (Array.isArray(element)) return element.map(child => button(child, label)).find(Boolean);
  if (!element?.props) return null;
  return element.type === 'button' && content(element) === label ? element : button(element.props.children, label);
}
const flush = async () => { for (let index = 0; index < 6; index++) await Promise.resolve(); };

test('ordinary delivery never opts into replacing storyboards', async () => {
  const page = panel({ outcome: { ...receipt, revisionSummary: undefined } });
  assert.doesNotMatch(page.html, /保存修订并更新分镜/);
  button(page.element, '同步剧本并进入资产设计').props.onClick();
  await flush();
  assert.equal(page.requests[0][3].storyboardRevision, undefined);
  assert.equal(page.notifications[0][2], 'assets');
});

test('a protected delivery explains preservation and requires the explicit revision action', async () => {
  const page = panel({ conflict: true });
  assert.match(page.html, /旧正文、旧分镜和已有生成结果会保留/);
  assert.match(page.html, /保存修订并更新分镜/);
  assert.equal(page.requests.length, 0);
  button(page.element, '保存修订并更新分镜').props.onClick();
  await flush();
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0][1], 'host-p');
  assert.equal(page.requests[0][3].storyboardRevision, 'preserve-history');
  assert.equal(page.requests[0][3].shots, false);
  assert.equal(page.notifications[0][2], 'storyboard');
});

test('double clicks cannot submit a second revision while the first is pending', async () => {
  let resolve;
  const outcome = new Promise(done => { resolve = done; });
  const page = panel({ conflict: true, outcome });
  const submit = button(page.element, '保存修订并更新分镜').props.onClick;
  submit(); submit();
  assert.equal(page.requests.length, 1);
  resolve(receipt);
  await flush();
  assert.equal(page.notifications.length, 1);
});

test('changed source must be reread before revision consent can be submitted', async () => {
  const page = panel({ conflict: true, updatedAt: 'newer-source' });
  button(page.element, '保存修订并更新分镜').props.onClick();
  await flush();
  assert.equal(page.requests.length, 0);
  assert.match(page.states[9], /刷新内容后再同步/);
});

test('a blocked revision keeps its explicit retry action and does not navigate or retry automatically', async () => {
  let reject;
  const outcome = new Promise((_resolve, failed) => { reject = failed; });
  const page = panel({ conflict: true, outcome });
  button(page.element, '保存修订并更新分镜').props.onClick();
  reject(Object.assign(new Error('目标项目仍有生成任务，请等待完成后导入'), { code: 'IMPORT_TASK_ACTIVE' }));
  await flush();
  assert.equal(page.requests.length, 1);
  assert.equal(page.notifications.length, 0);
  assert.equal(page.states[11], true);
  assert.equal(page.states[7], false);
  assert.match(page.states[9], /仍有生成任务/);
});

test('revision receipt reports preserved media and offers the storyboard as next step', () => {
  const page = panel({ result: receipt });
  assert.match(page.html, /复用 2 个镜头，更新 2 个镜头/);
  assert.match(page.html, /制作修订历史/);
  assert.match(page.html, /href="\/storyboard"[^>]*>查看修订后的分镜/);
});
