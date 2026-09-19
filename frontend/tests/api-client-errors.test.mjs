import assert from "node:assert/strict";
import test from "node:test";

import { userFacingError, visibleApiError } from "../lib/api-error.ts";
import { CreatorNarrativeLanguageError } from "../lib/mainland-language.ts";

test("storyboard conflicts retain actionable messages without exposing unknown errors", () => {
  for (const message of [
    "分镜版本已变化，请重新加载。",
    "本场包含已锁定镜头，请先解锁需要重编的场景。",
    "请先采用或放弃当前候选。",
  ]) {
    assert.equal(visibleApiError(message, 409), message);
    assert.equal(visibleApiError(message, 409, "overseas"), message);
  }
  const internal = "分镜版本已变化，请重新加载。 SQL credentials=private";
  assert.doesNotMatch(visibleApiError(internal, 409), /SQL|credentials|private/);
});

test("planning errors keep technical provider details out of the user interface", () => {
  assert.match(
    visibleApiError("LLM request timed out", 503),
    /生成服务响应超时/,
  );
  assert.match(
    visibleApiError("剧情规划模型响应超时，已保存的规划内容不会丢失，请重试当前部分。", 503),
    /生成服务响应超时/,
  );
  for (const detail of [
    "status 429: rate limit",
    "status 502: bad gateway",
    "Provider returned non-JSON success response (content-type text/html)",
    "connect ECONNREFUSED 127.0.0.1:8000",
  ]) {
    const message = visibleApiError(detail, 503);
    assert.match(message, /生成服务/);
    assert.doesNotMatch(message, /LLM|JSON|Base URL|ECONNREFUSED|供应商|网关|后端|状态码/i);
  }
});

test("unknown 503 no longer asserts that the model provider is unavailable", () => {
  const message = visibleApiError("unclassified failure", 503);
  assert.match(message, /生成服务暂时未完成请求/);
  assert.doesNotMatch(message, /上游模型服务暂时不可用/);
});

test("bible language rejection explains why the draft was not saved", () => {
  const message = visibleApiError(
    "The Story Bible contains unresolved quality conflicts: non-Chinese field: escalation_stages.4.stage_opposition",
    422,
  );
  assert.match(message, /未转换成中文/);
  assert.match(message, /本次未保存/);
  assert.doesNotMatch(message, /escalation_stages|non-Chinese|stage_opposition/);
});

test("configuration failures tell the user to fix settings instead of retrying", () => {
  const message = visibleApiError(
    "LLM_REASONING_EFFORT is invalid",
    503,
    "cn_mainland",
    "configuration",
  );
  assert.match(message, /配置当前不可用/);
  assert.match(message, /检查模型设置/);
  assert.doesNotMatch(message, /稍后重试|LLM_REASONING_EFFORT/);
});

test("direct rate-limit responses keep saved work safe without exposing retry internals", () => {
  const message = visibleApiError("429 Too Many Requests", 429);
  assert.match(message, /生成服务当前较忙/);
  assert.match(message, /已保存的内容不会丢失/);
  assert.doesNotMatch(message, /429|缺口|路线图|模型/);
});

test("user-facing errors preserve sanitized API diagnoses", () => {
  const safeMessage = "生成服务连接暂时中断，系统已保留此前成功保存的内容，请稍后重试。";
  assert.equal(
    userFacingError({ status: 503, message: safeMessage }, "创作方向候选生成失败。"),
    safeMessage,
  );
  assert.equal(
    userFacingError(new Error("DATABASE_URL is missing"), "创作方向候选生成失败。"),
    "创作方向候选生成失败。",
  );
});

test("candidate errors explain the actual recovery without exposing arbitrary server details", () => {
  const messages = [
    "本次方案生成超时，已有方案和答案已保留，请重新获取。",
    "本次没有生成有效候选，已有方案和答案已保留，请重新获取。",
    "本次候选与已展示方案重复或数量不足，已有方案和答案已保留，请换一批。",
  ];
  for (const message of messages) {
    assert.equal(visibleApiError(message, 422), message);
    assert.equal(visibleApiError(message, 422, "overseas"), message);
  }
  assert.doesNotMatch(visibleApiError(`${messages[0]} secret_details`, 422), /secret_details/);
});

test("retained bible candidates explain that retry continues the repair", () => {
  const message = "故事总纲还有少量内容未完成中文转换。已保留生成进度，请重试继续修正。";
  assert.equal(visibleApiError(message, 422), message);
});

test("local planning language errors retain field guidance without trusting arbitrary errors", () => {
  const error = new CreatorNarrativeLanguageError(["核心前提", "进入状态"]);
  assert.equal(userFacingError(error, "草稿保存失败"), error.message);
  assert.match(error.message, /核心前提、进入状态/);
  assert.match(error.message, /保留已确认的英文人物名/);
  assert.equal(userFacingError(new Error(error.message + " INTERNAL_SECRET"), "草稿保存失败"), "草稿保存失败");
});
