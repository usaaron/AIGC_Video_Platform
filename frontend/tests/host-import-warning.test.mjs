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

function renderReceipt(receipt, storyboardConflict = false) {
  const states = [false, [], 'host-p', null, [], true, true, false, false, '', receipt, storyboardConflict];
  let index = 0;
  const context = {
    exports: {},
    require(name) {
      if (name === 'react') return {
        useEffect() {}, useRef: value => ({ current: value }),
        useState: () => [states[index++], () => {}],
      };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === '@/lib/host-session') return { hostProjectId: () => 'host-p' };
      if (name === '@/lib/host-navigation') return { isHostEmbedded: () => false, isHostScriptWorkflow: () => true, notifyHost() {} };
      if (name === '@/lib/use-host-script-workflow') return { useHostScriptWorkflow: () => true };
      if (name === '@/components/host-return-link') return { HostWorkspaceLink: ({ children }) => createElement('a', { href: '/assets' }, children) };
      if (name === '@/lib/host-import') return {};
      throw new Error(`Unexpected dependency ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return renderToStaticMarkup(context.exports.HostImportPanel({ project: { id: 'p' }, onTarget() {}, onClose() {} }));
}

test('successful import displays optional fallback notices beside the receipt', () => {
  const receipt = { targetProjectId: 'host-p', importedEpisodes: 1, updatedEpisodes: 0 };
  const message = '第 1 集正文或资料已变化，本次按当前正文交付，资产资料将在主项目重新分析。';
  const notice = renderReceipt({ ...receipt, warnings: [message] });
  assert.ok(notice.includes(message));
  assert.match(notice, /class="inline-notice" role="status"/);
  assert.match(notice, /进入资产设计/);
  assert.equal(renderReceipt(receipt).includes(message), false);
});

test('blocked revision exposes routes to inspect the existing storyboard and delivered script', () => {
  const html = renderReceipt(null, true);
  assert.match(html, /查看已有分镜/);
  assert.match(html, /查看已交付版本/);
});
