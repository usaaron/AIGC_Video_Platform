import assert from "node:assert/strict";
import test from "node:test";
import { generateStoryBibleDraft, generateStoryInspirationTurn, generateStorySynopsisDraft, importStoryBibleDraft } from "../lib/story-planning-client.ts";
import { EMPTY_INSPIRATION_BRIEF } from "../lib/story-inspiration-session.ts";
import { DEFAULT_GENERATION_SETTINGS } from "../lib/types.ts";

const project = {
  id: "project.synopsis-test", title: "保留作者故事", creativePrompt: "原始输入",
  contentSpecId: "spec.synopsis", generationStrategyId: "strategy.synopsis",
  generationSettings: DEFAULT_GENERATION_SETTINGS, selectedTagIds: [], customTags: [],
  characters: [], referenceMaterials: [], episodes: [],
};

test("synopsis drafting carries the entire edited document, author decisions and recent messages", async (context) => {
  const currentText = "完整的作者正文。".repeat(1_600) + "最终她决定保留原件。";
  const brief = { ...EMPTY_INSPIRATION_BRIEF, ending_direction: "暂缓决定", must_avoid: ["不能让她销毁原件"] };
  const messages = Array.from({ length: 32 }, (_, index) => ({ role: "user", content: `第${index}条意见`, questions: [] }));
  const result = { text: "完整叙事草稿", review: { status: "draft", issues: [{ kind: "unresolved", message: "结局暂缓决定。" }] } };
  const controller = new AbortController();
  let request;
  context.mock.method(globalThis, "fetch", async (url, init) => {
    request = { url: String(url), body: JSON.parse(init.body), signal: init.signal };
    return Response.json({ data: result });
  });
  const actual = await generateStorySynopsisDraft({ ...project, creativePrompt: "早".repeat(11_000) }, messages, brief, currentText, controller.signal);
  assert.deepEqual(actual, result);
  assert.match(request.url, /story-bibles\/synopsis-draft$/);
  assert.equal(request.body.current_text, currentText);
  assert.deepEqual(request.body.current_brief, brief);
  assert.equal(request.body.creative_prompt.length, 10_000);
  assert.equal(request.body.messages.length, 30);
  assert.equal(request.body.messages[0].content, "第2条意见");
  assert.equal(request.signal, controller.signal);
});

test("oversized or failed synopsis generation cannot return a replacement document", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => Response.json({ data: { text: " ", review: { status: "draft", issues: [] } } }));
  await assert.rejects(generateStorySynopsisDraft(project, [], EMPTY_INSPIRATION_BRIEF, "文".repeat(20_001)), /不会截断或覆盖原稿/);
  assert.equal(fetchMock.mock.callCount(), 0);
  await assert.rejects(generateStorySynopsisDraft(project, [], EMPTY_INSPIRATION_BRIEF, "原稿"), /原稿已保留/);
});

test("normal and import story bibles receive full confirmed synopsis and unresolved notes", async (context) => {
  const requests = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ data: { id: "story-bible.test", status: "draft", version: 1 } });
  });
  const storySynopsis = {
    text: "作者的最终底稿。".repeat(1_300) + "最后一段结局必须保留。",
    status: "confirmed", pendingChanges: false,
    review: { status: "draft", issues: [{ kind: "proposal", message: "旁观者身份仍为候选，不能作为已定事实。" }] },
  };
  await generateStoryBibleDraft({ ...project, storySynopsis });
  await importStoryBibleDraft({ ...project, storySynopsis });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/draft$/);
  assert.match(requests[1].url, /\/import-draft$/);
  for (const { body } of requests) {
    assert.equal(body.confirmed_synopsis, storySynopsis.text);
    assert.deepEqual(body.synopsis_review_notes, [storySynopsis.review.issues[0].message]);
  }
});

test("unapplied discussion is never handed to a story bible as a confirmed synopsis", async (context) => {
  let body;
  context.mock.method(globalThis, "fetch", async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({ data: { id: "story-bible.test", status: "draft", version: 1 } });
  });
  await generateStoryBibleDraft({ ...project, storySynopsis: { text: "旧梗概", status: "confirmed", pendingChanges: true } });
  assert.equal(body.confirmed_synopsis, "");
  assert.deepEqual(body.synopsis_review_notes, []);
});

test("manual confirmation carries author reservations even after the old model review was cleared", async (context) => {
  let body;
  context.mock.method(globalThis, "fetch", async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({ data: { id: "story-bible.test", status: "draft", version: 1 } });
  });
  await importStoryBibleDraft({ ...project, storySynopsis: {
    text: "作者改写的梗概", status: "confirmed", pendingChanges: false,
    conversation: { brief: { ...EMPTY_INSPIRATION_BRIEF, unresolved: ["结局后议"], must_keep: ["原件仍由她保管"], must_avoid: ["不得杀死证人"] }, messages: [] },
  } });
  assert.deepEqual(body.synopsis_review_notes, ["待作者决定：结局后议", "作者要求保留：原件仍由她保管", "作者要求避免：不得杀死证人"]);
});

test("inspiration chat receives the complete long manual synopsis in its own field", async (context) => {
  const text = "手动改写的故事。".repeat(1_800) + "结尾：原件不能离开她的控制。";
  let request;
  context.mock.method(globalThis, "fetch", async (_url, init) => {
    request = JSON.parse(init.body);
    return Response.json({ data: { assistant_message: "已阅读结尾", questions: [], brief: EMPTY_INSPIRATION_BRIEF, ready_to_generate: false } });
  });
  await generateStoryInspirationTurn({ ...project, creativePrompt: "旧想法：她交出原件。", storySynopsis: { text } }, [], EMPTY_INSPIRATION_BRIEF, "检查最后一段");
  assert.equal(request.current_synopsis, text);
  assert.ok(request.current_synopsis.endsWith("结尾：原件不能离开她的控制。"));
  assert.equal(request.creative_prompt, "旧想法：她交出原件。");
});

test("oversized inspiration synopsis fails before any chat request rather than truncating the ending", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => { throw new Error("must not send"); });
  await assert.rejects(generateStoryInspirationTurn({ ...project, storySynopsis: { text: "文".repeat(20_001) } }, [], EMPTY_INSPIRATION_BRIEF, "检查结尾"), /不会截断或覆盖原稿/);
  assert.equal(fetchMock.mock.callCount(), 0);
});
