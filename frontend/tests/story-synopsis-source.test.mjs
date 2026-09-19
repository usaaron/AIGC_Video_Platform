import assert from "node:assert/strict";
import test from "node:test";
import { extractSourceSynopsis, synopsisSourceProject } from "../lib/story-synopsis-source.ts";

function project(text, creativePrompt = "") {
  return { creativePrompt, referenceMaterials: [{ fileName: "故事资料.md", purpose: "story_reference", extractedText: text }] };
}

test("extracts a complete multi-paragraph uploaded synopsis beyond the evidence budget", () => {
  const synopsis = `她在港口发现母亲留下的账本。${"她决定追查失踪的证人。".repeat(100)}\n\n证人出面作证，母女终于重新合作。`;
  const source = `# 创作资料\n\n## 故事梗概\n\n${synopsis}\n\n## 人物设定\n不能混入的人物介绍。`;
  assert.ok(synopsis.length > 800);
  assert.equal(extractSourceSynopsis(project(source)), synopsis);
});

test("stops at a sibling or higher Markdown heading without losing nested story headings", () => {
  const synopsis = "她决定调查。\n\n### 起因\n证人失踪。\n\n### 最后的选择\n她公开账本。";
  assert.equal(extractSourceSynopsis(project(`## 剧情梗概\n${synopsis}\n## 制作计划\n其他内容`)), synopsis);
  assert.equal(extractSourceSynopsis(project(`### 内容梗概\n她公开账本。\n# 附件\n其他内容`)), "她公开账本。");
});

test("extracts simple numbered Chinese headings and inline opening paragraphs", () => {
  assert.equal(extractSourceSynopsis(project("一、故事梗概：她回到故乡。\n\n她最终保护了妹妹。\n二、人物设定\n姐姐：调查员。")), "她回到故乡。\n\n她最终保护了妹妹。");
  assert.equal(extractSourceSynopsis(project("内容梗概\r\n她拒绝交易。\r\n\r\n她交出证据。\r\n总纲：\r\n其他内容")), "她拒绝交易。\r\n\r\n她交出证据。");
});

test("recognizes bold labels and English Story Synopsis", () => {
  assert.equal(extractSourceSynopsis(project("**故事梗概**\n她拒绝交易。\n**人物小传**\n不要混入。")), "她拒绝交易。");
  assert.equal(extractSourceSynopsis(project("## Story Synopsis\nMara returns home.\n\nShe protects her sister.\n## Characters\nMara: investigator.")), "Mara returns home.\n\nShe protects her sister.");
});

test("stops at explicit next-stage or episode headings even when Markdown depth increases", () => {
  assert.equal(extractSourceSynopsis(project("# 故事梗概\n她公开账本。\n### 分集规划\n第1集：回乡。")), "她公开账本。");
  assert.equal(extractSourceSynopsis(project("故事梗概：\n她找到母亲。\n第十二集：真相\n分集正文。")), "她找到母亲。");
});

test("does not infer a synopsis from an unlabelled source, filename, or prose mention", () => {
  assert.equal(extractSourceSynopsis(project("她要调查父亲。\n请把故事梗概写得完整。", "这是一个悬疑故事。")), null);
  assert.equal(extractSourceSynopsis({ creativePrompt: "", referenceMaterials: [{ fileName: "故事梗概.txt", extractedText: "没有明确梗概标题的小说正文。" }] }), null);
  assert.equal(extractSourceSynopsis(project("## 故事梗概\n\n## 人物设定\n小林是护士。")), null);
});

test("extracts the first nonempty explicit story source without combining files", () => {
  assert.equal(extractSourceSynopsis({
    creativePrompt: "请根据上传的故事梗概继续创作。",
    referenceMaterials: [
      { fileName: "参考.txt", purpose: "story_reference", extractedText: "只是参考风格。" },
      { fileName: "第一份.txt", purpose: "story_reference", extractedText: "故事梗概：第一份完整故事。" },
      { fileName: "第二份.txt", purpose: "story_reference", extractedText: "故事梗概：另一份完整故事。" },
    ],
  }), "第一份完整故事。");
  assert.equal(extractSourceSynopsis(project("只是参考风格。", "Story Synopsis: She returns home.")), "She returns home.");
});

test("does not use a template, style, world, character, or unspecified reference as the author's story", () => {
  for (const purpose of ["format_template", "style_reference", "world_setting", "character_reference", "other", undefined]) {
    const referenceMaterials = [{ fileName: "参考梗概.txt", purpose, extractedText: "故事梗概：模板人物决定逃亡。" }];
    assert.equal(extractSourceSynopsis({ creativePrompt: "", referenceMaterials }), null, purpose);
    assert.equal(extractSourceSynopsis({
      creativePrompt: "", referenceMaterials: [...referenceMaterials,
        { fileName: "用户故事.txt", purpose: "story_reference", extractedText: "故事梗概：主角决定留下。" }],
    }), "主角决定留下。", purpose);
  }
});

test("a current explicitly labelled author synopsis takes precedence over an older upload", () => {
  assert.equal(extractSourceSynopsis(project("故事梗概：她决定出走。", "故事梗概：她改为留下照顾妹妹。")), "她改为留下照顾妹妹。");
});

test("synopsis evidence filtering preserves reference indexes and existing author session decisions", () => {
  const referenceMaterials = [
    { purpose: "format_template", extractedText: "模板人物逃亡。" },
    { purpose: "story_reference", extractedText: "主角留下。" },
    { purpose: "world_setting", extractedText: "某个世界。" },
    { purpose: "character_reference", extractedText: "参考人物。" },
    { purpose: "style_reference", extractedText: "参考风格。" },
    { purpose: "other", extractedText: "未定用途。" },
  ];
  const source = {
    creativePrompt: "现在决定保护妹妹。", referenceMaterials,
    inputReadiness: { knownFacts: [
      { sourceId: "creative_prompt", quote: "现在决定保护妹妹。" },
      ...referenceMaterials.map((material, index) => ({ sourceId: `reference_${index + 1}`, quote: material.extractedText })),
      { sourceId: "reference_0", quote: "不存在的来源。" },
      { sourceId: "reference_99", quote: "不存在的来源。" },
      { sourceId: "generated", quote: "不是输入事实。" },
    ], supplementQuestions: ["作者问题"] },
    storySynopsis: { conversation: { brief: { creative_decisions: [{ decision_key: "author.change", value: "保留全部作者决定" }] } } },
  };
  const before = structuredClone(source);
  const filtered = synopsisSourceProject(source);
  assert.deepEqual(filtered.inputReadiness.knownFacts.map((fact) => fact.sourceId), ["creative_prompt", "reference_2"]);
  assert.equal(filtered.referenceMaterials, source.referenceMaterials);
  assert.deepEqual(filtered.storySynopsis, before.storySynopsis);
  assert.deepEqual(filtered.inputReadiness.supplementQuestions, ["作者问题"]);
  assert.deepEqual(source, before);
  assert.notEqual(filtered.inputReadiness, source.inputReadiness);
});

test("synopsis evidence filtering accepts projects before input diagnosis", () => {
  const source = project("故事梗概：她保护妹妹。");
  assert.equal(synopsisSourceProject(source), source);
});
