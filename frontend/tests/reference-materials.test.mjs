import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEpisodeReferenceMaterialContext,
  buildReferenceMaterialContext,
  extractDocxXmlText,
  hasUsableCreativeSource,
  referenceMaterialsForApi,
  validateReferenceFile,
} from "../lib/reference-materials.ts";

function material(overrides = {}) {
  return {
    id: "reference-1",
    fileName: "客户剧本模板.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 1200,
    purpose: "format_template",
    purposeNote: "保留场景标题顺序",
    extractedText: "第1集\nINT. 客厅 夜\n△她推开门。\n示例人物：你终于来了。",
    originalCharacterCount: 42,
    truncated: false,
    createdAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

test("DOCX XML extraction preserves paragraph and screenplay text order", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <w:document xmlns:w="urn:test"><w:body>
      <w:p><w:r><w:t>第1集</w:t></w:r></w:p>
      <w:p><w:r><w:t>INT. 客厅 夜</w:t></w:r></w:p>
      <w:p><w:r><w:t>△她推开门。</w:t></w:r></w:p>
    </w:body></w:document>`;

  assert.equal(extractDocxXmlText(xml), "第1集\nINT. 客厅 夜\n△她推开门。");
});

test("reference context tells the model how the file may be used", () => {
  const context = buildReferenceMaterialContext([material()], 4000);

  assert.match(context, /客户剧本模板\.docx/);
  assert.match(context, /只参考版式、字段顺序和剧本结构/);
  assert.match(context, /不得照搬其中的人物、台词或剧情/);
  assert.match(context, /用户补充说明：保留场景标题顺序/);
});

test("episode context repeats only format and style references", () => {
  const context = buildEpisodeReferenceMaterialContext([
    material({ id: "story", fileName: "剧情资料.txt", purpose: "story_reference" }),
    material({ id: "format", fileName: "格式模板.docx", purpose: "format_template" }),
    material({ id: "style", fileName: "对白风格.md", purpose: "style_reference" }),
  ], 2000);

  assert.match(context, /格式模板\.docx/);
  assert.match(context, /对白风格\.md/);
  assert.doesNotMatch(context, /剧情资料\.txt/);
  assert.ok(context.indexOf("格式模板.docx") < context.indexOf("对白风格.md"));
});

test("unsupported and oversized files are rejected before reading", () => {
  assert.throws(
    () => validateReferenceFile({ name: "扫描图.png", size: 100 }),
    /暂不支持/,
  );
  assert.throws(
    () => validateReferenceFile({ name: "过大.txt", size: 9 * 1024 * 1024 }),
    /8 MB/,
  );
});

test("reference API payload stays inside the backend filename contract", () => {
  const [payload] = referenceMaterialsForApi([
    material({ fileName: `${"长".repeat(260)}.txt` }),
  ]);

  assert.equal(payload.file_name.length, 240);
});

test("story content and uploaded files form an either-or creative input contract", () => {
  assert.equal(hasUsableCreativeSource("一个复仇故事", []), true);
  assert.equal(hasUsableCreativeSource("", [material()]), true);
  assert.equal(hasUsableCreativeSource("", []), false);
  assert.equal(
    hasUsableCreativeSource("  ", [material({ extractedText: "  " })]),
    false,
  );
});
