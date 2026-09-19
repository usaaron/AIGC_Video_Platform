import assert from "node:assert/strict";
import test from "node:test";

import {
  storySynopsisMarkdown,
  storySynopsisMarkdownFilename,
} from "../lib/story-synopsis-export.ts";

test("story synopsis export preserves the current version and readable text", () => {
  const markdown = storySynopsisMarkdown("逆光证词", {
    text: "林夏找到一段被删改的录音。\n\n她必须在证人消失前查出真相。",
    status: "confirmed",
    version: 3,
    source: "user",
    updatedAt: "2026-09-15T10:00:00.000Z",
  });

  assert.match(markdown, /# 逆光证词 - 故事梗概/);
  assert.match(markdown, /> 已确认版本 v3/);
  assert.match(markdown, /林夏找到一段被删改的录音。/);
  assert.match(markdown, /她必须在证人消失前查出真相。/);
  assert.equal(storySynopsisMarkdownFilename("逆光证词", 3), "逆光证词-故事梗概-v3.md");
});

test("export preserves pending author decisions after a manual edit invalidates model review", () => {
  const markdown = storySynopsisMarkdown("钥匙", {
    text: "妹妹保管唯一钥匙。", status: "draft", version: 4, source: "user", updatedAt: "2026-09-18",
    pendingChanges: true, conversation: { messages: [], brief: {
      unresolved: ["父亲结局待定。"], must_keep: ["钥匙由妹妹保管。"], must_avoid: ["不得新增魔法。"],
    } },
  });
  assert.match(markdown, /讨论中的修改尚未写入/);
  assert.match(markdown, /待作者决定：父亲结局待定/);
  assert.match(markdown, /作者要求保留：钥匙由妹妹保管/);
  assert.match(markdown, /作者要求避免：不得新增魔法/);
});
