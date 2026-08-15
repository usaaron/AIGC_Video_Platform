import assert from "node:assert/strict";
import test from "node:test";

import {
  creativeDirectionInputSignature,
  storyPlanningInputSignature,
} from "../lib/story-planning-signature.ts";

function projectFixture() {
  return {
    creativePrompt: "一名记者追查旧案。",
    referenceMaterials: [],
    selectedTagIds: ["genre.suspense"],
    customTags: [],
    selectedCreativeDirection: {
      title: "现实悬疑",
      style_description: "克制推进",
      content_description: "通过证据链逐步揭示真相",
    },
    characters: [{
      id: "character.user.lin-xia",
      name: "林夏",
      age: "29",
      gender: "女",
      role: "主角",
      background: "调查记者",
      appearance: "短发",
      description: "谨慎但执着",
      source: "user",
    }],
    generationSettings: {
      episodeCountMode: "recommended",
      episodeCount: 120,
      targetTotalCharacters: 600000,
      storyDensity: "balanced",
      customInstructions: "",
    },
  };
}

test("changing an uploaded reference purpose invalidates planning input", () => {
  const reference = {
    id: "ref-1",
    fileName: "模板.docx",
    purpose: "format_template",
    purposeNote: "",
    extractedText: "INT. 客厅 夜",
    originalCharacterCount: 10,
  };
  const originalProject = projectFixture();
  const original = storyPlanningInputSignature({
    ...originalProject,
    referenceMaterials: [reference],
  });
  const changed = storyPlanningInputSignature({
    ...originalProject,
    referenceMaterials: [{ ...reference, purpose: "story_reference" }],
  });

  assert.notEqual(original, changed);
});

test("Story Bible generated characters do not invalidate creative or planning input", () => {
  const beforeApproval = projectFixture();
  const afterApproval = {
    ...beforeApproval,
    characters: [
      ...beforeApproval.characters,
      {
        id: "story-bible-character.partner",
        name: "周野",
        age: "",
        gender: "",
        role: "搭档",
        background: "总纲自动补充",
        appearance: "",
        description: "总纲自动补充",
        source: "generated",
      },
    ],
  };

  assert.equal(
    creativeDirectionInputSignature(afterApproval),
    creativeDirectionInputSignature(beforeApproval),
  );
  assert.equal(
    storyPlanningInputSignature(afterApproval),
    storyPlanningInputSignature(beforeApproval),
  );
});

test("legacy custom characters no longer affect planning input", () => {
  const project = projectFixture();
  const legacy = {
    ...project,
    characters: project.characters.map(({ source: _source, ...character }) => character),
  };
  const changed = {
    ...legacy,
    characters: legacy.characters.map((character) => ({
      ...character,
      description: "更加冲动",
    })),
  };

  assert.equal(
    storyPlanningInputSignature(changed),
    storyPlanningInputSignature(legacy),
  );
});

test("character-card edits do not become planning input", () => {
  const project = projectFixture();
  const generated = {
    id: "story-bible-character.partner",
    name: "周野",
    age: "",
    gender: "",
    role: "搭档",
    background: "总纲自动补充",
    appearance: "",
    description: "总纲自动补充",
    source: "generated",
  };
  const withGenerated = { ...project, characters: [...project.characters, generated] };
  const afterUserEdit = {
    ...withGenerated,
    characters: withGenerated.characters.map((character) => (
      character.id === generated.id
        ? { ...character, description: "用户确认的新设定", source: "user" }
        : character
    )),
  };

  assert.equal(
    storyPlanningInputSignature(afterUserEdit),
    storyPlanningInputSignature(withGenerated),
  );
});
