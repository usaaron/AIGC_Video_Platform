// Real UI acceptance driver. Commands and artifacts are retained for replay.
// No API mocks, workspace mutation, or preapproved fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { chromium, expect as baseExpect } from '@playwright/test';
const out = path.resolve(process.argv[2]);
const base = process.argv[3] || 'http://127.0.0.1:3010';
const backend = process.argv[4] || 'http://127.0.0.1:8010';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const expect = baseExpect.configure({ timeout: 30000 });
const S = { processId: process.pid, startedAt: new Date().toISOString(), base, backend, targetCharacters: 100000, targetEpisodes: 72, projectId: null, command: null, errors: [], requests: [], apiInterception: false };
let counter = 0;
const pending = new Set();
const save = async (name, data) => fs.writeFile(path.join(out, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
const progress = async () => save('status.json', { ...S, memory: process.memoryUsage(), updatedAt: new Date().toISOString() });
page.on('pageerror', e => { S.errors.push(e.message); console.log('PAGE_ERROR', e.message); });
page.on('requestfailed', request => {
  const u = new URL(request.url());
  if (u.origin !== backend && !u.pathname.startsWith('/api/')) return;
  if (request.method() === 'OPTIONS') return;
  const record = { id: ++counter, time: new Date().toISOString(), method: request.method(), path: u.pathname, status: 0, failure: request.failure()?.errorText ?? 'request failed' };
  S.requests.push(record);
  console.log('REQUEST_FAILED', JSON.stringify(record));
});
page.on('response', response => {
  const u = new URL(response.url());
  if (u.origin !== backend && !u.pathname.startsWith('/api/')) return;
  const method = response.request().method();
  if (method === 'OPTIONS') return;
  const id = ++counter;
  const record = { id, time: new Date().toISOString(), method, path: u.pathname, status: response.status() };
  S.requests.push(record);
  if (!/input-readiness|content-specs|story-projects|script-generation/.test(u.pathname)) return;
  if (method === 'GET' && /workspace|generation-tasks|planning-session/.test(u.pathname)) return;
  const job = (async () => {
    if (response.headers()['content-type']?.includes('application/json')) {
      const data = await response.json();
      let request = null;
      if (method !== 'GET') { try { request = response.request().postDataJSON(); } catch {} }
      await save(`response-${String(id).padStart(5,'0')}.json`, { ...record, request, data });
    } else if (u.pathname.includes('/generate-draft/stream')) {
      await save(`generation-${String(id).padStart(5,'0')}-request.json`, {
        ...record, request: response.request().postDataJSON(),
      });
      await save(`generation-${String(id).padStart(5,'0')}.sse`, await response.text());
    }
  })().catch(e => S.errors.push(`capture ${id}: ${e.message}`)).finally(() => pending.delete(job));
  pending.add(job);
});
async function workspace() {
  const r = await context.request.get(`${backend}/story-projects/${S.projectId}/workspace`);
  try {
    if (!r.ok()) throw new Error(`workspace ${r.status()}`);
    return (await r.json()).data.workspace_payload;
  } finally { await r.dispose(); }
}
async function snapshot(name) {
  await save(`${name}.txt`, await page.locator('body').innerText());
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true, timeout: 30000 }).catch(e => S.errors.push(e.message));
  if (S.projectId) await save(`${name}-workspace.json`, await workspace());
  await progress();
}
async function download(name, action) {
  const promise = page.waitForEvent('download');
  await action(); const file = await promise;
  const dest = path.join(out, `${name}-${file.suggestedFilename()}`);
  await file.saveAs(dest); console.log('DOWNLOAD', dest); return dest;
}
const button = name => page.getByRole('button', { name, exact: true });
let handlingControl = false;
const tick = setInterval(async () => {
  await progress();
  if (handlingControl) return;
  handlingControl = true;
  try {
    const controlPath = path.join(out, 'control.json');
    const command = JSON.parse(await fs.readFile(controlPath, 'utf8'));
    await fs.rename(controlPath, path.join(out, `control-${Date.now()}.json`));
    if (command.action === 'pause') {
      const pause = button('暂停');
      if (await pause.isVisible() && await pause.isEnabled()) await pause.click();
    }
    if (command.action === 'pause-conversation') {
      const pause = page.getByRole('button', { name: '暂停当前思考', exact: true });
      if (await pause.isVisible() && await pause.isEnabled()) await pause.click();
    }
    if (command.action === 'pause-production') {
      const pause = button('立即暂停正文生成').first();
      if (await pause.isVisible() && await pause.isEnabled()) await pause.click();
    }
    if (command.action === 'snapshot') await snapshot('live-inspection');
  } catch (error) {
    if (error.code !== 'ENOENT') console.log('CONTROL_ERROR', error.message);
  } finally { handlingControl = false; }
}, 10000);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
await page.goto(base);
console.log('READY', out);
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  const cmd = JSON.parse(line);
  if (cmd.close) break;
  S.command = { name: cmd.name, status: 'running', startedAt: new Date().toISOString() };
  await fs.appendFile(path.join(out, 'commands.jsonl'), JSON.stringify(cmd) + '\n');
  await progress(); console.log('START', cmd.name);
  try {
    const run = new AsyncFunction('page','context','S','expect','button','snapshot','workspace','save','download','out','base','backend','fs',cmd.file ? await fs.readFile(cmd.file, 'utf8') : cmd.code);
    const result = await run(page,context,S,expect,button,snapshot,workspace,save,download,out,base,backend,fs);
    S.command.status='passed'; console.log('RESULT',cmd.name,JSON.stringify(result));
  } catch(e) {
    S.command.status='failed'; S.command.error=e.stack;
    console.log('FAILED',cmd.name,e.stack); await snapshot(`failure-${cmd.name}`).catch(()=>{});
  }
  S.command.finishedAt = new Date().toISOString(); await progress();
}
clearInterval(tick); await snapshot('final').catch(()=>{}); await context.close(); await Promise.allSettled(pending); await browser.close();
