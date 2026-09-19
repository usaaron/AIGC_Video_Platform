import assert from "node:assert/strict";
import test from "node:test";
import { prepareAuthorInstruction, validateAuthorInstructionRequest } from "../lib/author-modification-instructions.ts";
import { visibleApiError } from "../lib/api-error.ts";
import { apiRequest } from "../lib/api-client.ts";
import { modifyEpisodeDraft } from "../lib/generation-client.ts";

const entry = (id, instruction = "保留原有节奏") => ({ id, instruction, createdAt: "2026-09-17T00:00:00Z" });

test("a retry preserves its identity and an edit withdraws the later branch without deleting history", () => {
  const original = [entry("first"), entry("second", "不要新增精确时间")];
  const retry = prepareAuthorInstruction(original, original[1].instruction, null);
  assert.equal(retry.current.id, "second");
  assert.equal(retry.history.length, 2);
  assert.deepEqual(retry.prior.map((item) => item.id), ["first"]);
  const edited = prepareAuthorInstruction(original, "保留原定速度", null, { replaceId: "first", id: "replacement" });
  assert.equal(edited.history.length, 3);
  assert.ok(edited.history[0].withdrawnAt && edited.history[1].withdrawnAt);
  assert.deepEqual(edited.prior, []);
  assert.equal(original[0].withdrawnAt, undefined);
});

test("history limits reject excess without trimming and count Unicode codepoints including selections", () => {
  const current = entry("current", "继续修订");
  assert.doesNotThrow(() => validateAuthorInstructionRequest(current, Array.from({ length: 32 }, (_, i) => entry(String(i)))));
  assert.throws(() => validateAuthorInstructionRequest(current, Array.from({ length: 33 }, (_, i) => entry(String(i)))), /32/);
  assert.throws(() => validateAuthorInstructionRequest(current, [entry("same"), entry("same")]));
  const prior = Array.from({ length: 7 }, (_, i) => entry(String(i), "😀".repeat(4000)));
  assert.doesNotThrow(() => validateAuthorInstructionRequest(entry("c", "😀".repeat(4000)), prior));
  assert.throws(() => validateAuthorInstructionRequest({ ...entry("c", "😀".repeat(4000)), selection_context: { source_field: "x" } }, prior), /32000/);
  assert.throws(() => prepareAuthorInstruction([entry("original")], "修改", null, { replaceId: "original" }), /3–4000/);
});

test("the actual modification transport includes only supplied active prior requirements in order", async (t) => {
  let sent;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    sent = JSON.parse(init.body);
    return Response.json({ data: { instruction: "本次修订" } });
  });
  const prior = [{ id: "prior-1", instruction: "保留原定速度", selection_context: null }];
  await modifyEpisodeDraft({ draft_master_script: { id: "draft" } }, { id: "draft" }, "本次修订", undefined, null, undefined, undefined, prior);
  assert.deepEqual(sent.prior_author_instructions, prior);
  assert.equal(sent.instruction, "本次修订");
  await modifyEpisodeDraft({}, { id: "draft" }, "老请求兼容");
  assert.equal("prior_author_instructions" in sent, false);
});

test("real API errors preserve actionable history limits without exposing arbitrary details", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: [{
    type: "too_long", loc: ["body", "prior_author_instructions"], msg: "List should have at most 32 items", ctx: { max_length: 32 },
  }] }, { status: 422 }));
  await assert.rejects(apiRequest("/script-generation/modify-draft", { method: "POST" }), /最多 32 条/);
  assert.match(visibleApiError("Value error, Current and prior author instruction/selection text exceeds 32000 characters; edit or explicitly withdraw obsolete requirements before retrying. Nothing was truncated.", 422), /32000.*撤回/);
  assert.match(visibleApiError("Value error, Prior author instruction IDs must be distinct.", 422), /标识重复/);
  assert.match(visibleApiError("prior_author_instructions.1.selection_context.selected_text: String should have at most 1200 characters", 422), /历史作者要求/);
  assert.equal(visibleApiError("private internal database text", 422).includes("private"), false);
});
