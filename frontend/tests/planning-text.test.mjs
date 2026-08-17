import assert from "node:assert/strict";
import test from "node:test";

import {
  compactTopLevelSynopsis,
  normalizePlanningPunctuation,
} from "../lib/planning-text.ts";

test("top-level planning text repairs duplicated assembly punctuation", () => {
  const value = "本部分以目标甲。；目标乙。为行动目标，正面遭遇阻力甲。。人物取得回报甲。，其结果继续引出升级甲。。";

  const normalized = normalizePlanningPunctuation(value);

  assert.equal(
    normalized,
    "本部分以目标甲；目标乙为行动目标，正面遭遇阻力甲。人物取得回报甲，其结果继续引出升级甲。",
  );
  assert.doesNotMatch(normalized, /。；|。。|。，|。为行动目标/u);
});

test("top-level synopsis remains compact after punctuation repair", () => {
  const value = `${"剧情推进。；".repeat(60)}阶段结束。。`;
  const compact = compactTopLevelSynopsis(value);

  assert.ok(compact.length <= 240);
  assert.match(compact, /。$/u);
  assert.doesNotMatch(compact, /。；|。。|；。/u);
});
