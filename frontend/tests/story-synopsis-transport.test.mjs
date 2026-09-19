import assert from "node:assert/strict";
import test from "node:test";
import { generateStoryBibleDraft, importStoryBibleDraft, generateStorySynopsisDraft } from "../lib/story-planning-client.ts";
import { EMPTY_INSPIRATION_BRIEF } from "../lib/story-inspiration-session.ts";

function project() {
  return {
    id: "project.synopsis-transport", contentSpecId: "spec.synopsis", generationStrategyId: "strategy.synopsis",
    creativePrompt: "早期版本：妹妹交出钥匙。", referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
    generationSettings: { episodeCount: 8 },
    storySynopsis: { text: "作者确认妹妹保管钥匙。".repeat(900) + "最终钥匙仍由妹妹保管。", status: "confirmed",
      source: "user", version: 5, pendingChanges: false,
      review: { status: "draft", issues: [{ kind: "unresolved", message: "父亲结局暂缓。" }] } },
  };
}

test("normal and imported bibles receive the whole latest synopsis apart from bounded instructions", async t => {
  const input = project();
  const requests = [];
  const decisions = [{ decision_key: "ending_direction.father", value: "父亲结局暂缓。", status: "deferred", authority: "provisional" }];
  t.mock.method(globalThis, "fetch", async (url, request) => {
    requests.push({ url: String(url), body: JSON.parse(request.body) });
    return Response.json({ data: { version: 1, status: "draft" } });
  });
  await generateStoryBibleDraft(input, undefined, "早期要求".repeat(3000), undefined, decisions);
  await importStoryBibleDraft(input, undefined, undefined, decisions, "早期要求".repeat(3000));
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/draft$/);
  assert.match(requests[1].url, /\/import-draft$/);
  for (const { body } of requests) {
    assert.equal(body.confirmed_synopsis, input.storySynopsis.text);
    assert.deepEqual(body.synopsis_review_notes, ["父亲结局暂缓。"]);
    assert.deepEqual(body.creative_decisions, decisions);
    assert.ok(body.author_instruction.length <= 7500);
  }
});

test("synthesis receives the entire current author draft and pending discussion", async t => {
  const input = project();
  input.storySynopsis.pendingChanges = true;
  const brief = { ...EMPTY_INSPIRATION_BRIEF, unresolved: ["父亲结局暂缓。"] };
  const messages = [{ role: "user", content: "保留钥匙设定，结局暂缓。", questions: [] }];
  let captured;
  t.mock.method(globalThis, "fetch", async (url, request) => {
    captured = { url: String(url), body: JSON.parse(request.body) };
    return Response.json({ data: { text: input.storySynopsis.text, review: input.storySynopsis.review } });
  });
  const output = await generateStorySynopsisDraft(input, messages, brief);
  assert.match(captured.url, /\/synopsis-draft$/);
  assert.equal(captured.body.current_text, input.storySynopsis.text);
  assert.deepEqual(captured.body.current_brief.unresolved, brief.unresolved);
  assert.equal(captured.body.messages[0].content, messages[0].content);
  assert.equal(output.text, input.storySynopsis.text);
});

test("oversized synopsis is rejected before transport instead of silently losing its ending", async t => {
  const input = project();
  input.storySynopsis.text = "文".repeat(20001);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; throw new Error("Unexpected request"); });
  await assert.rejects(generateStorySynopsisDraft(input, [], EMPTY_INSPIRATION_BRIEF));
  await assert.rejects(generateStoryBibleDraft(input));
  assert.equal(calls, 0);
});
