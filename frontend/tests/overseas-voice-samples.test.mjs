import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { overseasVoiceValidationText, OverseasVoiceSampleError } from '../lib/overseas-voice-samples.ts';
import { saveStoryBibleDraft, confirmStoryBible } from '../lib/story-planning-client.ts';
import { CreatorNarrativeLanguageError } from '../lib/mainland-language.ts';
import { userFacingError } from '../lib/api-error.ts';
import { episodeActingDirection } from '../lib/episode-generation-planning.ts';

const fixtures = JSON.parse(await readFile(new URL('../../tests/fixtures/overseas_voice_samples.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) {
  test(`shared voice grammar: ${fixture.label}`, () => {
    const validated = overseasVoiceValidationText(fixture.value, fixture.allowedNames ?? []);
    assert.equal(validated.valid, fixture.valid);
  });
}

const sample = "拒绝｜EN: I can't promise you that.｜中译: 我不能向你保证。";
const project = { id: 'voice.project', generationSettings: { releaseRegion: 'overseas' }, characters: [], episodes: [] };
const bible = (value, field = 'permanentVoicePrompt') => ({
  story_bible_id: 'voice.bible', story_project_id: project.id, version: 1, status: 'draft',
  core_premise: '一名记者核对旧案证据。', series_goal: '公开完整证据。', theme: '信任',
  central_conflict: '姐姐拒绝公开过去。', ending_direction: '各自选择新生活。',
  world_rules: [], locked_facts: [], avoid_patterns: [], story_lines: [],
  character_registry: [{ character_ref: 'character.lena', name: 'Lena', role: '记者', acting_profile: { [field]: value } }],
});

for (const [label, save] of [['draft', saveStoryBibleDraft], ['approval', confirmStoryBible]]) {
  test(`valid voice examples survive ${label} persistence without edits`, async t => {
    const voice = `表达克制，样例只示范声音，不是剧情事实。\n${sample}\n示弱｜EN: Stay a minute.｜中译: 再留一会儿。`;
    const source = bible(voice); const before = structuredClone(source); const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      requests.push(JSON.parse(init.body)); return Response.json({ data: requests.at(-1) });
    });
    const saved = await save(source, project);
    assert.equal(requests.length, 1);
    assert.equal(saved.character_registry[0].acting_profile.permanentVoicePrompt, voice);
    assert.equal(saved.version, 2);
    assert.deepEqual(source, before);
  });
}

test('invalid samples explain their format and stop persistence while preserving the edit', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('unexpected persistence'); });
  for (const value of [sample.replace(/｜中译:.*/, ''), `${'说明。'.repeat(50)}\nI refuse.`, '中'.repeat(601)]) {
    const source = bible(value); const before = structuredClone(source);
    await assert.rejects(saveStoryBibleDraft(source, project), error => {
      assert.ok(error instanceof OverseasVoiceSampleError);
      assert.equal(userFacingError(error, '保存失败'), error.message);
      assert.match(error.message, /Lena · 永久声音提示词/);
      assert.match(error.message, /拒绝｜EN: …｜中译: …/);
      assert.match(error.message, /最多3条/);
      assert.match(error.message, /不超过600字符/);
      return true;
    });
    assert.deepEqual(source, before);
  }
  assert.equal(requests, 0);
});

test('English sample exception cannot escape overseas permanent voice or permit other English prose', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected persistence'); });
  for (const field of ['bodyLanguage', 'voice', 'movement', 'gazeAndAttention', 'habitualActions', 'pressureResponse', 'relationshipBehavior']) {
    await assert.rejects(saveStoryBibleDraft(bible(sample, field), project), CreatorNarrativeLanguageError);
  }
  await assert.rejects(saveStoryBibleDraft(bible(sample), { ...project, generationSettings: { releaseRegion: 'cn_mainland' } }), CreatorNarrativeLanguageError);
  await assert.rejects(saveStoryBibleDraft({ ...bible(sample), core_premise: 'Lena opens the door.' }, project), /以下内容需要使用中文叙述/);
});

function castAndScenes(count, longSample = false) {
  const characters = Array.from({ length: count }, (_, index) => ({
    id: `character.${index}`, name: `Person${index}`, motivation: '取回证据',
    dynamicState: { currentGoal: '核实去向', physicalState: '左肩受伤', activeConstraints: ['不能暴露身份'] },
    actingProfile: {
      bodyLanguage: '身体重心后移。'.repeat(100), voice: '音量逐渐降低。'.repeat(100),
      permanentVoicePrompt: longSample
        ? `拒绝｜EN: ${'I cannot promise you that. '.repeat(18)}｜中译: 我不能向你保证。`
        : `声音克制，不主动解释。\n拒绝｜EN: Not now, ${index}.｜中译: 现在不行。\n示弱｜EN: Stay, ${index}.｜中译: 留下。`,
    },
  }));
  const constraint = { episodeNumber: 1, episodeRoadmap: {
    episode_number: 1, character_refs: characters.map(item => item.id), planned_dialogue_line_count: 30,
    scene_execution_plan: Array.from({ length: 5 }, (_, index) => ({
      scene_number: index + 1, scene_objective: `核实记录${index + 1}，${'逐项对照。'.repeat(100)}`,
      opposition: `看守回头${index + 1}`, visible_action: `展开证据${index + 1}`,
      dialogue_objective: `追问来源${index + 1}`, turn_or_reveal: `记录不同${index + 1}`, dialogue_line_target: 6,
    })),
  } };
  return { characters, constraint };
}

test('bounded acting context gives later characters whole samples and keeps all scene directions', () => {
  const { characters, constraint } = castAndScenes(4);
  const original = structuredClone({ characters, constraint });
  const direction = episodeActingDirection({ characters }, constraint);
  assert.ok(direction.length <= 3000, String(direction.length));
  for (let index = 0; index < 4; index++) {
    assert.ok(direction.includes(`Person${index}`));
    assert.ok(direction.includes(`拒绝｜EN: Not now, ${index}.｜中译: 现在不行。`));
    assert.ok(direction.includes(`示弱｜EN: Stay, ${index}.｜中译: 留下。`));
  }
  for (let number = 1; number <= 5; number++) {
    for (const detail of [`核实记录${number}`, `展开证据${number}`, `追问来源${number}`, `记录不同${number}`]) assert.ok(direction.includes(detail), detail);
  }
  assert.match(direction, /样例只示范表达方式，不是已发生的剧情/);
  assert.match(direction, /作者明确指令/);
  assert.deepEqual({ characters, constraint }, original);
});

test('oversized samples are omitted whole with an explicit note inside the unchanged budget', () => {
  const { characters, constraint } = castAndScenes(8, true);
  const direction = episodeActingDirection({ characters }, constraint);
  assert.ok(direction.length <= 3000, String(direction.length));
  for (const character of characters) assert.ok(direction.includes(character.name));
  assert.equal((direction.match(/声音例句因长度未纳入/g) ?? []).length, 8);
  assert.doesNotMatch(direction, /EN:|I cannot/);
  assert.match(direction, /场5目标：核实记录5/);
  assert.match(direction, /勿补造/);
});
