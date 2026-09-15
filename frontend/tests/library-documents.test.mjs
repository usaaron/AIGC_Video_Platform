import assert from 'node:assert/strict';
import test from 'node:test';
import { libraryDocuments } from '../lib/library-documents.ts';
import { GET } from '../app/api/library/route.ts';
const draft = { title: '归来', characters: [], scenes: [{ scene_number: 1, slug: '诊所 内 日', dialogues: [], character_actions: ['林晚推开木门。'] }] };
const episode = (n) => ({ episodeNumber: n, status: 'saved', generationRun: { draft_master_script: draft }, updatedAt: '2026-09-16T00:00:00Z' });
const project = { id: 'project-test', title: '归来', updatedAt: '2026-09-16T00:00:00Z', episodes: [episode(2), episode(1)] };
test('catalog exports episodes in order, a complete collection, and skips empty planning states', () => {
 const documents = libraryDocuments(project);
 assert.equal(documents.length, 3);
 assert.match(documents[0].title, /第 1 集/);
 assert.match(documents[2].content, /林晚推开木门/);
 assert.deepEqual(libraryDocuments({ ...project, episodes: [{}] }), []);
});
test('catalog requires auth and forwards the account token to every backend read', async (t) => {
 assert.equal((await GET(new Request('http://test/api/library'))).status, 401);
 const urls = [];
 t.mock.method(globalThis, 'fetch', async (url, init) => {
   urls.push(url); assert.equal(init.headers.Authorization, 'Bearer fixture-token');
   return Response.json(url.includes('/workspace') ? { data: { workspace_payload: project } } : { data: [{ project_id: 'project-test' }], total: 1 });
 });
 const response = await GET(new Request('http://test/api/library', { headers: { Authorization: 'Bearer fixture-token' } }));
 assert.equal(response.status, 200); assert.equal((await response.json()).documents.length, 3); assert.equal(urls.length, 2);
});
test('catalog preserves backend authorization failures', async (t) => {
 t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
 assert.equal((await GET(new Request('http://test/api/library', { headers: { Authorization: 'Bearer denied' } }))).status, 403);
});
