import assert from "node:assert/strict";
import test from "node:test";
import { buildCreatorCatalog, combineHongguoCatalogs, groupCreatorTags, hongguoTagId, hongguoTagLabel, hongguoTagOption, hongguoTrendOptions, manualCreatorTags, manualCustomTagCount, toggleCreatorTag } from "../lib/hongguo-tags.ts";
import { availableCreatorTags, creatorTagIdentity, creatorTagMatchesQuery, getTag, matchingSelectedTagIds, projectTagLabel, projectTagLabels, resolveProjectTagSelection, uniqueSelectedTagIds } from "../lib/tag-catalog.ts";
import { DEFAULT_GENERATION_SETTINGS } from "../lib/types.ts";
import { generateStoryInspirationTurn, prepareStoryPlanningProject, storyPlanningInputSignature } from "../lib/story-planning-client.ts";
import { generateSingleEpisode } from "../lib/generation-client.ts";

const nodes = [
  { id: "genre.fantasy", label: "玄幻", category: "Genre", description: "大陆玄幻故事", is_active: true },
  { id: "theme.rebirth", label: "重生", category: "Theme", description: "带着记忆重新选择人生", is_active: true },
  { id: "theme.system", label: "系统", category: "Theme", description: "系统任务推动剧情", is_active: false },
];

function catalog(format, fields = {}) {
  return { format, status: "fresh", stale: false, fetched_at: "2026-09-12T00:00:00Z", ...fields };
}

function recommendation(label, tagId, fields = {}) {
  return { label, tag_id: tagId, raw_labels: [label], rank: 1, ranked_work_count: 1, weighted_score: 1, sample_works: [], ...fields };
}

test("creator catalog collapses legacy duplicates and keeps technical controls out of story choices", () => {
  const runtime = [
    ["emotion.hot_blooded", "热血", "Emotion"], ["emotion.passion", "Passion", "Emotion"],
    ["emotion.oppressive", "压迫感", "Emotion"], ["emotion.dark", "Dark", "Emotion"],
    ["audience.youth", "青年受众", "Audience"], ["audience.teen", "Teen", "Audience"],
    ["audience.young_adult", "Young Adult", "Audience"], ["world.modern_city", "现代都市", "World"],
    ["hook.opening_crisis", "开局危机", "Hook"], ["pace.escalation", "稳步升级", "Pace"],
  ].map(([id, label, category]) => ({ id, label, category, description: label, is_active: true }));
  const tags = availableCreatorTags(runtime, "cn_mainland");
  for (const label of ["热血", "压迫感", "青年受众", "都市"]) assert.equal(tags.filter((tag) => tag.labelZh === label).length, 1, label);
  assert.ok(!tags.some((tag) => tag.id.startsWith("hook.") || tag.id.startsWith("pace.")));
  assert.deepEqual(tags.filter((tag) => tag.category === "Audience").map((tag) => tag.labelZh), ["女频受众", "男频受众", "青年受众", "熟龄受众"]);
  assert.ok(getTag("audience.romance"));
  assert.equal(new Set(tags.map((tag) => creatorTagIdentity(tag))).size, tags.length);
});

test("source tags have one category and distinct compound meanings survive", () => {
  const labels = ["都市爱情", "家庭", "逆袭", "豪门", "脑洞", "成长", "重生逆袭", "隐藏大佬", "奇幻", "恐怖", "年代爱情", "古装", "古代", "剧情", "综艺"];
  const tags = buildCreatorCatalog(availableCreatorTags([], "cn_mainland"), labels.map((label) => ({ label })), "cn_mainland");
  for (const label of ["都市爱情", "家庭", "逆袭", "古装", "剧情", "综艺"]) assert.ok(!tags.some((tag) => tag.labelZh === label), label);
  assert.equal(tags.filter((tag) => tag.labelZh === "古代").length, 1);
  for (const label of ["豪门", "脑洞", "成长", "重生逆袭", "隐藏大佬"]) assert.equal(tags.find((tag) => tag.labelZh === label).category, "Story Element");
  for (const label of ["奇幻", "玄幻", "恐怖", "惊悚", "重生", "重生逆袭", "成长", "逆袭成长"]) assert.ok(tags.some((tag) => tag.labelZh === label), label);
  const genres = groupCreatorTags(tags.filter((tag) => tag.category === "Genre"), "Genre");
  assert.ok(genres.find((group) => group.key === "baseGenres").tags.some((tag) => tag.labelZh === "爱情"));
  assert.deepEqual(genres.find((group) => group.key === "mixedGenres").tags.map((tag) => tag.labelZh), ["强情感虐恋", "现代言情", "古代言情", "年代爱情"]);
  const elements = groupCreatorTags(tags.filter((tag) => tag.category === "Story Element"), "Story Element");
  for (const [key, label] of [["settings", "隐藏身份"], ["relationships", "先婚后爱"], ["plot", "身份暴露"]]) {
    assert.ok(elements.find((group) => group.key === key).tags.some((tag) => tag.labelZh === label));
  }
});

test("synonyms share checked state, one slot and a single removal across old and custom IDs", () => {
  const custom = [{ id: "custom.alias", label: "逆风翻盘" }];
  const selected = [hongguoTagId("逆袭"), "theme.power_growth", custom[0].id, "theme.rebirth"];
  const tag = getTag("theme.power_growth");
  assert.equal(uniqueSelectedTagIds(selected, custom).length, 2);
  assert.deepEqual(matchingSelectedTagIds(tag, selected, custom), selected.slice(0, 3));
  assert.deepEqual(toggleCreatorTag(tag, selected, custom).selectedTagIds, ["theme.rebirth"]);
  const eleven = [...selected.slice(0, 3), ...Array.from({ length: 10 }, (_, i) => `theme.extra${i}`)];
  assert.equal(toggleCreatorTag(getTag("theme.rebirth"), eleven, custom).limit, undefined);
  assert.equal(creatorTagIdentity({ id: "custom.pending", labelZh: "都市爱情" }), "genre.modern_romance");
  assert.ok(creatorTagMatchesQuery(getTag("genre.modern_romance"), "都市爱情"));
});

test("My Tags only contains unique manual additions, excluding platform and catalog aliases", () => {
  const custom = [
    { id: hongguoTagId("萌宝"), label: "萌宝" }, { id: "custom.romance", label: "都市爱情" },
    { id: "custom.unique", label: "一案双线" }, { id: "custom.copy", label: " 一案双线 " },
  ];
  const available = availableCreatorTags([], "cn_mainland");
  assert.deepEqual(manualCreatorTags(custom, available, "cn_mainland").map((tag) => tag.labelZh), ["一案双线"]);
  assert.equal(manualCustomTagCount(custom, available), 1);
});

test("cached trending synonyms share labels without double-counting incomplete evidence", () => {
  const records = [recommendation("逆袭", "theme.power_growth", { ranked_work_count: 10 }),
    recommendation("逆风翻盘", null, { ranked_work_count: 8 }), recommendation("重生逆袭", null), recommendation("剧情", null)];
  const options = hongguoTrendOptions(records, availableCreatorTags([], "cn_mainland"), []);
  assert.deepEqual(options.map(({ tag }) => tag.labelZh), ["逆袭成长", "重生逆袭"]);
  assert.equal(options[0].record.ranked_work_count, 10);
  assert.equal(options[1].record.rank, 2);
});

test("generation prefers a selected active ontology equivalent while retaining input order", () => {
  const project = { generationSettings: DEFAULT_GENERATION_SETTINGS, customTags: [],
    selectedTagIds: [hongguoTagId("萌宝"), hongguoTagId("都市爱情"), "genre.modern_romance", "theme.system"] };
  const result = resolveProjectTagSelection(project, [...nodes, { id: "genre.modern_romance", label: "现代言情", is_active: true }]);
  assert.deepEqual(result, { systemTagIds: ["genre.modern_romance"], creativeTagLabels: ["萌宝", "系统"] });
});

test("combined categories retain all sources and merge canonical aliases", () => {
  const feeds = [
    catalog("real", { categories: [{ label: "家庭", tag_id: "genre.family" }, { label: "爱情", tag_id: "genre.romance" }] }),
    catalog("comic", { fetched_at: "2026-09-11T23:55:00Z", categories: [{ label: "脑洞" }, { label: "家庭伦理", tag_id: "genre.family" }] }),
    catalog("ai", { categories: [{ label: "脑洞" }, { label: "奇幻" }] }),
  ];
  const result = combineHongguoCatalogs(feeds);
  assert.deepEqual(result.categories.map((tag) => tag.label), ["家庭", "爱情", "脑洞", "奇幻"]);
  assert.equal(result.fetched_at, "2026-09-11T23:55:00Z");
  assert.equal(result.stale, false);
  assert.deepEqual(combineHongguoCatalogs([...feeds].reverse()), result);
  assert.deepEqual(combineHongguoCatalogs([...feeds, feeds[0]]), result);
});

test("combined popularity sums ranking appearances and deduplicates sample work links", () => {
  const shared = { title: "同一作品", url: "https://hongguoduanju.com/work/1", rank: 8 };
  const other = { title: "另一作品", url: "https://hongguoduanju.com/work/2", rank: 2 };
  const feeds = [
    catalog("real", { sample_work_count: 10, recommendations: [
      recommendation("家庭", "genre.family", { ranked_work_count: 2, weighted_score: 0.5, sample_works: [shared, other] }),
      recommendation("爱情", "genre.romance", { weighted_score: 0.8 }),
    ] }),
    catalog("comic", { sample_work_count: 20, recommendations: [
      recommendation("家庭伦理", "genre.family", { weighted_score: 0.5, sample_works: [{ ...shared, rank: 1 }] }),
    ] }),
    catalog("ai", { sample_work_count: 30, recommendations: [recommendation("脑洞", null)] }),
  ];
  const original = structuredClone(feeds);
  const result = combineHongguoCatalogs(feeds);
  assert.equal(result.sample_work_count, 60);
  assert.deepEqual(result.recommendations.map((tag) => [tag.label, tag.rank]), [["家庭", 1], ["脑洞", 2], ["爱情", 3]]);
  assert.deepEqual(result.recommendations[0].raw_labels, ["家庭", "家庭伦理"]);
  assert.equal(result.recommendations[0].ranked_work_count, 3);
  assert.equal(result.recommendations[0].weighted_score, 1);
  assert.deepEqual(result.recommendations[0].sample_works.map((work) => [work.url, work.rank]), [[shared.url, 1], [other.url, 2]]);
  assert.deepEqual(feeds, original);
});

test("combined feeds retain stale data and mark partial coverage without inventing counts", () => {
  const live = catalog("real", { sample_work_count: 10, recommendations: [recommendation("爱情", "genre.romance")] });
  const cached = catalog("comic", { status: "stale", stale: true, sample_work_count: 20, recommendations: [recommendation("脑洞", null)] });
  const unavailable = catalog("ai", { status: "unavailable", sample_work_count: 99, recommendations: [recommendation("忽略失效数据", null)] });
  const mixed = combineHongguoCatalogs([live, cached, unavailable]);
  assert.equal(mixed.stale, true);
  assert.equal(mixed.sample_work_count, 30);
  assert.equal(mixed.recommendations.length, 2);
  const partial = combineHongguoCatalogs([live]);
  assert.equal(partial.stale, true);
  assert.equal(partial.sample_work_count, 10);
  assert.equal(combineHongguoCatalogs([unavailable]), null);
  assert.equal(combineHongguoCatalogs([]), null);
});

test("project market determines labels even with a mainland runtime catalog", () => {
  const cn = availableCreatorTags(nodes, "cn_mainland");
  const overseas = availableCreatorTags(nodes, "overseas_tiktok");
  assert.equal(cn.find((tag) => tag.id === "genre.fantasy").labelZh, "玄幻");
  assert.equal(overseas.find((tag) => tag.id === "genre.fantasy").labelZh, "奇幻");
  assert.equal(overseas.find((tag) => tag.id === "genre.fantasy").label, "Fantasy");
  assert.ok(cn.some((tag) => tag.id === "theme.system"));
  assert.equal(getTag("element.rebirth", "overseas_tiktok").id, "theme.rebirth");
});

test("unknown source labels retain stable IDs and are persisted only on selection", () => {
  const first = hongguoTagOption({ label: "萌宝", tag_id: null }, [], []);
  const repeated = hongguoTagOption({ label: "萌宝", tag_id: null }, [], []);
  assert.equal(first.id, repeated.id);
  assert.equal(hongguoTagLabel(first.id), "萌宝");
  assert.equal(hongguoTagLabel("custom.hongguo.zzzz"), undefined);
  assert.equal(hongguoTagLabel(hongguoTagId("AI异界")), "AI异界");
  const selected = toggleCreatorTag(first, [], []);
  assert.deepEqual(selected.selectedTagIds, [first.id]);
  assert.equal(selected.customTags[0].label, "萌宝");
  const changedCatalog = [{ ...first, id: "theme.children", custom: false }];
  const afterSync = hongguoTagOption({ label: "萌宝", tag_id: "theme.children" }, changedCatalog, selected.customTags);
  assert.equal(afterSync.id, first.id);
  const removed = toggleCreatorTag(afterSync, selected.selectedTagIds, selected.customTags);
  assert.deepEqual(removed.selectedTagIds, []);
  assert.equal(removed.customTags, selected.customTags);
});

test("mapped tags retain ontology IDs and aliases do not create duplicate selections", () => {
  const available = availableCreatorTags(nodes, "cn_mainland");
  const first = hongguoTagOption({ label: "重生", tag_id: "theme.rebirth" }, available, []);
  assert.equal(first.id, "theme.rebirth");
  const selected = toggleCreatorTag(first, [], []);
  assert.deepEqual(selected.customTags, []);
  assert.deepEqual(toggleCreatorTag(first, selected.selectedTagIds, []).selectedTagIds, []);
  const missingCanonical = hongguoTagOption({ label: "系统", tag_id: "theme.system" }, [], []);
  assert.equal(missingCanonical.custom, true);
});

test("selection limits do not save an unselectable platform tag or erase existing tags", () => {
  const tag = hongguoTagOption({ label: "异界" }, [], []);
  const selected = Array.from({ length: 12 }, (_, index) => `theme.${index}`);
  const result = toggleCreatorTag(tag, selected, []);
  assert.equal(result.limit, "selected");
  assert.equal(result.selectedTagIds, selected);
  assert.deepEqual(result.customTags, []);
  const custom = Array.from({ length: 20 }, (_, index) => ({ id: `custom.${index}`, label: `标签${index}` }));
  const full = toggleCreatorTag(tag, [], custom);
  assert.equal(full.limit, undefined);
  assert.deepEqual(full.selectedTagIds, [tag.id]);
  assert.equal(full.customTags.length, 21);
  assert.deepEqual(full.customTags.slice(0, 20), custom);
  assert.equal(manualCustomTagCount(full.customTags), 20);
  const manual = { ...tag, id: "custom.manual-extra" };
  assert.equal(toggleCreatorTag(manual, [], full.customTags).limit, "custom");
  assert.deepEqual(toggleCreatorTag({ ...manual, id: custom[0].id }, [], full.customTags).selectedTagIds, [custom[0].id]);
});

test("trying many platform tags does not exhaust manual or platform selections", () => {
  let state = { selectedTagIds: [], customTags: [] };
  for (let index = 0; index < 30; index += 1) {
    const tag = hongguoTagOption({ label: `题材${index}` }, [], state.customTags);
    state = toggleCreatorTag(tag, state.selectedTagIds, state.customTags);
    assert.equal(state.limit, undefined);
    assert.ok(state.selectedTagIds.includes(tag.id));
    state = toggleCreatorTag(tag, state.selectedTagIds, state.customTags);
  }
  assert.equal(manualCustomTagCount(state.customTags), 0);
  const manual = { id: "custom.manual", labelZh: "一案双线", custom: true };
  assert.equal(toggleCreatorTag(manual, [], state.customTags).limit, undefined);
});

test("labels survive missing metadata, inactive nodes and legacy catalog changes", () => {
  const project = { generationSettings: DEFAULT_GENERATION_SETTINGS, customTags: [],
    selectedTagIds: ["element.rebirth", "theme.rebirth", "theme.system", "genre.mystery", hongguoTagId("萌宝")] };
  assert.deepEqual(resolveProjectTagSelection(project, nodes), {
    systemTagIds: ["theme.rebirth"], creativeTagLabels: ["系统", "悬疑", "萌宝"],
  });
  assert.equal(projectTagLabel(project, hongguoTagId("萌宝")), "萌宝");
  for (const market of ["cn_mainland", "overseas_tiktok"]) {
    const available = availableCreatorTags(nodes, market);
    for (const tag of available) {
      const result = resolveProjectTagSelection({ ...project, selectedTagIds: [tag.id] }, nodes);
      assert.equal(result.systemTagIds.length + result.creativeTagLabels.length, 1, tag.id);
    }
  }
  assert.throws(() => resolveProjectTagSelection({ ...project, selectedTagIds: ["custom.lost-name"] }, nodes), /名称已丢失/);
});

test("duplicate labels do not fail the planning API uniqueness constraint", () => {
  const project = { generationSettings: DEFAULT_GENERATION_SETTINGS,
    selectedTagIds: ["theme.rebirth", "element.rebirth", "custom.rebirth", "custom.upper", "custom.lower"],
    customTags: [{ id: "custom.rebirth", label: " 重生 " }, { id: "custom.upper", label: "AI" }, { id: "custom.lower", label: "ai" }],
  };
  assert.deepEqual(projectTagLabels(project), ["重生", "AI"]);
});

test("Hongguo selection survives content-spec resolution and reaches planning as a label", async (context) => {
  const selected = toggleCreatorTag(hongguoTagOption({ label: "萌宝" }, [], []), ["theme.rebirth"], []);
  const project = { id: "project.hg.test", title: "萌宝重生记", creativePrompt: "一个记得前世的孩子寻找失散家人，并揭开家族秘密。",
    referenceMaterials: [], episodes: [], ...selected, generationSettings: { ...DEFAULT_GENERATION_SETTINGS }, customTags: selected.customTags };
  const bodies = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    const path = String(url).replace(/^\/api/, "");
    const body = init?.body ? JSON.parse(init.body) : null;
    if (body) bodies.push([path, body]);
    const data = path === "/ontology-nodes" ? nodes
      : path === "/platform-profiles" ? [{ id: "platform.cn", platform_name: "hongguo", metadata: { runtime_status: "active", market_profile: "cn_mainland" } }]
      : path === "/generation-strategies" ? [{ id: "strategy.cn", status: "active", target_platform: "hongguo", applicable_tags: [] }]
      : path === "/content-specs/resolve-creative-intent" ? { content_spec: { id: "spec.cn" }, resolved_creative_context: {} }
      : { assistant_message: "继续", questions: [], brief: {}, ready_to_generate: false };
    return Response.json({ data });
  });
  const prepared = await prepareStoryPlanningProject(project);
  await generateStoryInspirationTurn(prepared, [], {}, "继续");
  const resolution = bodies.find(([path]) => path === "/content-specs/resolve-creative-intent")[1];
  assert.deepEqual(resolution.selected_tag_ids, ["theme.rebirth"]);
  assert.ok(resolution.creative_brief.generation_notes.some((note) => note.includes("萌宝")));
  const inspiration = bodies.find(([path]) => path.endsWith("inspiration-chat"))[1];
  assert.deepEqual(inspiration.selected_tag_labels, ["重生", "萌宝"]);
  assert.equal(projectTagLabel(prepared, selected.customTags[0].id), "萌宝");
  assert.notEqual(storyPlanningInputSignature(project), storyPlanningInputSignature({ ...project,
    generationSettings: { ...project.generationSettings, releaseRegion: "overseas" } }));
});

test("unmapped tags without custom records reach both planning and episode generation", async (context) => {
  const project = { id: "project.hg.restored", title: "异界寻亲记", creativePrompt: "孩子穿越异界寻找失散家人，一路破解这个世界的奇怪规则。",
    referenceMaterials: [], episodes: [], selectedTagIds: [hongguoTagId("萌宝"), "theme.system"], customTags: [],
    generationSettings: { ...DEFAULT_GENERATION_SETTINGS } };
  const bodies = [];
  const profile = { id: "platform.cn", platform_name: "hongguo", metadata: { runtime_status: "active", market_profile: "cn_mainland" } };
  const strategy = { id: "strategy.cn", status: "active", target_platform: "hongguo", applicable_tags: [] };
  context.mock.method(globalThis, "fetch", async (url, init) => {
    const path = String(url).replace(/^\/api/, "");
    if (init?.body) bodies.push([path, JSON.parse(init.body)]);
    const data = path === "/ontology-nodes" ? nodes
      : path === "/platform-profiles" ? [profile]
      : path === "/generation-strategies" ? [strategy]
      : path === "/content-specs/resolve-creative-intent" ? { content_spec: { id: "spec.fallback" }, resolved_creative_context: {} }
      : path === "/script-generation/generate-draft" ? { draft_master_script: { id: "draft.fallback" } }
      : { assistant_message: "继续", questions: [], brief: {}, ready_to_generate: false };
    return Response.json({ data });
  });
  const restored = JSON.parse(JSON.stringify(project));
  const prepared = await prepareStoryPlanningProject(restored);
  await generateStoryInspirationTurn(prepared, [], {}, "继续");
  const generated = await generateSingleEpisode(restored, undefined, undefined, {
    nodesResponse: { data: nodes }, profilesResponse: { data: [profile] },
    strategiesResponse: { data: [strategy] }, confirmedCheckpoint: null,
  });
  const resolutions = bodies.filter(([path]) => path === "/content-specs/resolve-creative-intent");
  assert.equal(resolutions.length, 2);
  for (const [, resolution] of resolutions) {
    assert.deepEqual(resolution.selected_tag_ids, []);
    assert.ok(resolution.creative_brief.generation_notes.some((note) => note.includes("萌宝、系统")));
  }
  assert.deepEqual(bodies.find(([path]) => path.endsWith("inspiration-chat"))[1].selected_tag_labels, ["萌宝", "系统"]);
  assert.equal(bodies.find(([path]) => path === "/script-generation/generate-draft")[1].content_spec_id, "spec.fallback");
  assert.equal(generated.draft_master_script.id, "draft.fallback");
});
