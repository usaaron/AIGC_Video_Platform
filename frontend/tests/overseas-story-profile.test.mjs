import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GENERATION_SETTINGS, enforceMarketDeliveryContract } from '../lib/types.ts';
import { normalizeGenerationSettings } from '../lib/generation-planning.ts';
import { creativePromptWithOverseasProfile, overseasStoryProfileForApi, overseasStoryProfileMatchesSignature } from '../lib/overseas-story-profile.ts';
import { creativeDirectionInputSignature, storyPlanningInputSignature } from '../lib/story-planning-signature.ts';
import { storyBibleRewriteVersionSeed, storyPlanningRevisionSeed } from '../lib/story-planning-state.ts';
import { prepareStoryPlanningProject, generateCreativeDirections, generateStorySynopsisDraft, generateStoryInspirationTurn,
  storyPlanQualityAuditMatchesNodes } from '../lib/story-planning-client.ts';
import { generateSingleEpisode } from '../lib/generation-client.ts';
import { loadServerProjects, queueProjectServerSync } from '../lib/project-sync.ts';

const profile = { enabled: true, country: ' United Kingdom ', region: ' Manchester ',
  socialContext: ' 工厂关闭后\n邻里互相隐瞒债务。\n', storyEngine: ' 每次帮忙都产生新的承诺。 ' };
const wireProfile = { schema_version: 'overseas_story_profile.v1', country: 'United Kingdom', region: 'Manchester',
  social_context: '工厂关闭后\n邻里互相隐瞒债务。', story_engine: '每次帮忙都产生新的承诺。' };
function projectFixture(overrides = {}) {
  return { id: 'project.profile', title: '旧城记事', marketProfile: 'overseas_tiktok', creativePrompt: '一名记者追查旧案。',
    referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [], episodes: [],
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    generationSettings: { ...DEFAULT_GENERATION_SETTINGS, releaseRegion: 'overseas', overseasStoryProfile: structuredClone(profile) },
    ...overrides };
}
const withoutProfile = settings => { const { overseasStoryProfile: _, ...rest } = settings; return rest; };

test('typing and storage preserve spaces and newlines; only wire values trim and old projects stay field-free', () => {
  assert.equal(Object.hasOwn(DEFAULT_GENERATION_SETTINGS, 'overseasStoryProfile'), false);
  assert.equal(Object.hasOwn(normalizeGenerationSettings(), 'overseasStoryProfile'), false);
  for (const value of [undefined, null, {}, [], { ...profile, enabled: false }, { ...profile, enabled: 'true' }]) {
    assert.equal(Object.hasOwn(normalizeGenerationSettings({ overseasStoryProfile: value }), 'overseasStoryProfile'), false);
  }
  const source = projectFixture().generationSettings;
  const normalized = normalizeGenerationSettings(source);
  assert.deepEqual(normalized.overseasStoryProfile, profile);
  assert.notEqual(normalized.overseasStoryProfile, source.overseasStoryProfile);
  assert.deepEqual(overseasStoryProfileForApi(normalized), wireProfile);
  assert.deepEqual(enforceMarketDeliveryContract(normalized, 'cn_mainland').overseasStoryProfile, profile);
  assert.equal(overseasStoryProfileForApi(enforceMarketDeliveryContract(normalized, 'cn_mainland')), undefined);
  const bounded = normalizeGenerationSettings({ overseasStoryProfile: { enabled: true, country: '中'.repeat(100),
    region: '区'.repeat(200), socialContext: '社'.repeat(900), storyEngine: '事'.repeat(900) } });
  assert.deepEqual(Object.values(bounded.overseasStoryProfile).slice(1).map(text => text.length), [80, 120, 800, 800]);
});

test('rewriting and planning-revision copies own independent profile objects', () => {
  const original = projectFixture();
  for (const copy of [storyBibleRewriteVersionSeed(original, '新版'), storyPlanningRevisionSeed(original)]) {
    assert.deepEqual(copy.draft.generationSettings.overseasStoryProfile, profile);
    copy.draft.generationSettings.overseasStoryProfile.country = 'Canada';
    assert.equal(original.generationSettings.overseasStoryProfile.country, profile.country);
  }
});

test('profile changes invalidate planning and creative choices only while explicitly enabled overseas', () => {
  const base = projectFixture();
  const plain = { ...base, generationSettings: withoutProfile(base.generationSettings) };
  const disabled = { ...base, generationSettings: { ...base.generationSettings, overseasStoryProfile: { ...profile, enabled: false } } };
  const mainland = { ...base, generationSettings: { ...base.generationSettings, releaseRegion: 'cn_mainland' } };
  for (const signature of [creativeDirectionInputSignature, storyPlanningInputSignature]) {
    assert.equal(signature(plain), signature(disabled));
    assert.equal(signature(mainland), signature({ ...mainland, generationSettings: withoutProfile(mainland.generationSettings) }));
    assert.notEqual(signature(base), signature(plain));
    assert.equal(signature(base), signature({ ...base, generationSettings: { ...base.generationSettings,
      overseasStoryProfile: { ...profile, country: 'United Kingdom' } } }));
    for (const field of ['country', 'region', 'socialContext', 'storyEngine']) {
      assert.notEqual(signature(base), signature({ ...base, generationSettings: { ...base.generationSettings,
        overseasStoryProfile: { ...profile, [field]: '改变背景' } } }), field);
    }
  }
  assert.equal(creativeDirectionInputSignature(plain), '{"creativePrompt":"一名记者追查旧案。","referenceMaterials":[],"selectedTagIds":[],"customTags":[]}');
  assert.equal(storyPlanningInputSignature(plain), JSON.stringify({ creativePrompt: plain.creativePrompt,
    referenceMaterials: [], selectedTagIds: [], customTags: [], selectedCreativeDirection: null, authorInstruction: '',
    generation: { releaseRegion: 'overseas', episodeCountMode: DEFAULT_GENERATION_SETTINGS.episodeCountMode,
      episodeCount: DEFAULT_GENERATION_SETTINGS.episodeCount, targetTotalCharacters: DEFAULT_GENERATION_SETTINGS.targetTotalCharacters,
      storyDensity: DEFAULT_GENERATION_SETTINGS.storyDensity, customInstructions: '' } }));
  assert.equal(overseasStoryProfileMatchesSignature(base.generationSettings, storyPlanningInputSignature(base)), true);
  assert.equal(overseasStoryProfileMatchesSignature(plain.generationSettings, storyPlanningInputSignature(base)), false);
  assert.equal(overseasStoryProfileMatchesSignature(base.generationSettings, 'broken'), false);
  assert.equal(overseasStoryProfileMatchesSignature(plain.generationSettings, undefined), true);
});

test('profile prompt reserves source space at both planning limits and never assumes a country', () => {
  const settings = { ...projectFixture().generationSettings, overseasStoryProfile: {
    enabled: true, country: '', region: '边境城镇', socialContext: '社'.repeat(800), storyEngine: '因'.repeat(800) } };
  const source = '原'.repeat(12000);
  for (const limit of [0, 1, 2, 20, 2000, 10000]) {
    const prompt = creativePromptWithOverseasProfile(source, settings, limit);
    assert.ok(prompt.length <= limit);
    if (limit < 2000) continue;
    assert.match(prompt, /国家：未指定，不推定具体国家/);
    assert.match(prompt, /地区：边境城镇/);
    assert.ok((prompt.match(/原/g) ?? []).length >= Math.floor(limit * 0.55));
    assert.match(prompt, /社会环境：社/); assert.match(prompt, /连续冲突来源：因/);
    assert.doesNotMatch(prompt, /美国|America/);
  }
});

const profiles = ['overseas_tiktok', 'cn_mainland'].map((market, i) => ({ id: `platform.${i}`,
  platform_name: i ? 'hongguo' : 'tiktok', metadata: { runtime_status: 'active', market_profile: market } }));
const strategies = profiles.map((platform, i) => ({ id: `strategy.${i}`, status: 'active', target_platform: platform.platform_name, applicable_tags: [] }));
const runtime = { nodesResponse: { data: [] }, profilesResponse: { data: profiles }, strategiesResponse: { data: strategies }, confirmedCheckpoint: null };
function mockPlanning(t) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const path = new URL(input, 'http://profile.test').pathname.replace(/^\/api/, '');
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (body) requests.push({ path, body });
    const data = path === '/ontology-nodes' ? [] : path === '/platform-profiles' ? profiles
      : path === '/generation-strategies' ? strategies
      : path === '/content-specs/resolve-creative-intent' ? { content_spec: { id: 'spec.profile' }, resolved_creative_context: {} }
      : path === '/script-generation/generate-draft' ? { draft_master_script: { id: 'draft.profile', characters: [], scenes: [] } }
      : path.endsWith('/synopsis-draft') ? { text: '记者逐步核对证据。', review: {} }
      : path.endsWith('/creative-directions/draft') ? { directions: [] }
      : { assistant_message: '继续', questions: [], brief: {}, ready_to_generate: false };
    return Response.json({ data });
  });
  return requests;
}

test('ContentSpec, directions, inspiration and synopsis carry the profile within existing request bounds', async t => {
  const requests = mockPlanning(t);
  const input = projectFixture({ creativePrompt: '原'.repeat(12000) });
  input.generationSettings.overseasStoryProfile.socialContext = '社'.repeat(800);
  input.generationSettings.overseasStoryProfile.storyEngine = '因'.repeat(800);
  const prepared = await prepareStoryPlanningProject(input);
  await generateCreativeDirections(prepared);
  await generateStoryInspirationTurn(prepared, [], {}, '继续');
  await generateStorySynopsisDraft(prepared, [], {});
  const resolution = requests.find(item => item.path === '/content-specs/resolve-creative-intent').body;
  assert.deepEqual(resolution.request_metadata.overseas_story_profile, { ...wireProfile, social_context: '社'.repeat(800), story_engine: '因'.repeat(800) });
  assert.ok(resolution.creative_brief.generation_notes.some(note => note.includes('社'.repeat(800)) && note.includes('因'.repeat(800))));
  for (const request of requests.filter(item => item.path !== '/content-specs/resolve-creative-intent')) {
    const limit = request.path.endsWith('/creative-directions/draft') ? 2000 : 10000;
    assert.ok(request.body.creative_prompt.length <= limit);
    assert.ok(request.body.creative_prompt.includes('国家：United Kingdom'));
    assert.ok((request.body.creative_prompt.match(/原/g) ?? []).length >= Math.floor(limit * 0.55));
    assert.equal(Object.hasOwn(request.body, 'overseas_story_profile'), false, 'no new endpoint contract');
  }
});

test('an inactive profile leaves actual legacy ContentSpec requests byte-for-byte unchanged', async t => {
  const requests = mockPlanning(t);
  for (const releaseRegion of ['overseas', 'cn_mainland']) {
    const base = projectFixture({ generationSettings: { ...DEFAULT_GENERATION_SETTINGS, releaseRegion } });
    await prepareStoryPlanningProject(base);
    await prepareStoryPlanningProject({ ...base, generationSettings: { ...base.generationSettings,
      overseasStoryProfile: { ...profile, enabled: releaseRegion === 'cn_mainland' } } });
    const pair = requests.filter(item => item.path === '/content-specs/resolve-creative-intent').slice(-2);
    assert.equal(JSON.stringify(pair[0].body), JSON.stringify(pair[1].body));
    assert.equal(Object.hasOwn(pair[0].body.request_metadata, 'overseas_story_profile'), false);
  }
});

test('episode generation refreshes cached ContentSpec when a profile changes or is disabled', async t => {
  const requests = mockPlanning(t);
  const prepared = await prepareStoryPlanningProject(projectFixture());
  const resolutions = () => requests.filter(item => item.path === '/content-specs/resolve-creative-intent');
  await generateSingleEpisode(prepared, undefined, undefined, runtime);
  assert.equal(resolutions().length, 1, 'reuse unchanged profile');
  await generateSingleEpisode({ ...prepared, generationSettings: { ...prepared.generationSettings,
    overseasStoryProfile: { ...profile, country: 'Canada' } } }, undefined, undefined, runtime);
  assert.equal(resolutions().at(-1).body.request_metadata.overseas_story_profile.country, 'Canada');
  await generateSingleEpisode({ ...prepared, generationSettings: withoutProfile(prepared.generationSettings) }, undefined, undefined, runtime);
  assert.equal(Object.hasOwn(resolutions().at(-1).body.request_metadata, 'overseas_story_profile'), false);
  assert.equal(resolutions().length, 3);
  const legacy = { ...prepared, storyBibleInputSignature: undefined, generationSettings: withoutProfile(prepared.generationSettings) };
  await generateSingleEpisode(legacy, undefined, undefined, runtime);
  assert.equal(resolutions().length, 3, 'legacy cache keeps previous behavior');
});

test('saved review PASS binds the effective profile while preserving the legacy four-item source signature', () => {
  const source = { ...projectFixture(), storyBibleVersion: 3, storySynopsis: { version: 2, status: 'confirmed', text: '记者核对证据。' } };
  const nodes = [{ node_id: 'leaf', version: 1, story_bible_id: 'bible', story_bible_version: 3,
    planned_start_episode: 1, planned_end_episode: 8, status: 'approved', expansion_status: 'episode_ready' }];
  const legacySignature = [source.id, 'bible', 3, [2, 'confirmed', source.storySynopsis.text]];
  const audit = { review_contract_version: 13, reviewed_episode_plans: '[]', story_project_id: source.id,
    story_bible_id: 'bible', story_bible_version: 3, status: 'pass', findings: [], node_refs: [{ node_id: 'leaf', node_version: 1 }],
    reviewed_source_fingerprint: 'ab'.repeat(32), reviewed_source_signature: JSON.stringify([...legacySignature, wireProfile]) };
  const matches = (entry, project) => storyPlanQualityAuditMatchesNodes(entry, nodes, [], { project });
  assert.equal(matches(audit, source), true);
  const plain = { ...source, generationSettings: withoutProfile(source.generationSettings) };
  assert.equal(matches(audit, plain), false);
  assert.equal(matches({ ...audit, reviewed_source_signature: JSON.stringify(legacySignature) }, plain), true);
  assert.equal(matches(audit, { ...source, generationSettings: { ...source.generationSettings,
    overseasStoryProfile: { ...profile, country: 'Canada' } } }), false);
});

test('server workspace save and reload preserve authored profile whitespace and do not opt legacy projects in', async t => {
  const timestamp = '2026-09-01T00:00:00.000Z';
  const remote = id => ({ project_id: id, title: '旧城记事', revision: 2, content_spec_id: null,
    active_story_bible_version: null, created_at: timestamp, updated_at: timestamp });
  const profiled = projectFixture();
  const legacy = projectFixture({ id: 'project.legacy', generationSettings: withoutProfile(profiled.generationSettings) });
  const payloads = new Map([profiled, legacy].map(project => [project.id, project]));
  const writes = [];
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => 'profile-test', setItem: () => {} } };
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const path = new URL(input, 'http://profile.test').pathname.replace(/^\/api/, '');
    if (path === '/story-projects') return Response.json({ data: [...payloads.keys()].map(remote), total: 2, offset: 0, limit: 100 });
    const [, id, resource] = path.match(/^\/story-projects\/([^/]+)(?:\/(.+))?$/) ?? [];
    assert.ok(id, path);
    if (resource === 'workspace') {
      if (init.method === 'PUT') { const body = JSON.parse(init.body); writes.push(body); payloads.set(id, body.workspace_payload); }
      return Response.json({ data: { revision: init.method === 'PUT' ? 4 : 3, updated_at: timestamp, workspace_payload: payloads.get(id) } });
    }
    if (resource === 'planning-session') return Response.json({ detail: 'not found' }, { status: 404 });
    if (resource === 'generation-tasks/recoverable') return Response.json({ data: null });
    assert.equal(resource, undefined);
    return Response.json({ data: { ...remote(id), revision: 3 } });
  });
  const loaded = await loadServerProjects();
  assert.equal(loaded.available, true);
  const restored = loaded.projects.find(item => item.id === profiled.id);
  assert.deepEqual(restored.generationSettings.overseasStoryProfile, profile);
  assert.equal(Object.hasOwn(loaded.projects.find(item => item.id === legacy.id).generationSettings, 'overseasStoryProfile'), false);
  const saved = await queueProjectServerSync({ ...restored, updatedAt: '2026-09-02T00:00:00.000Z' });
  assert.equal(saved.status, 'synced', JSON.stringify(saved));
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].workspace_payload.generationSettings.overseasStoryProfile, profile);
  assert.deepEqual((await loadServerProjects()).projects.find(item => item.id === profiled.id).generationSettings.overseasStoryProfile, profile);
});
