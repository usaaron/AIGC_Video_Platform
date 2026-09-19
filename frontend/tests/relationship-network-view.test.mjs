import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import vm from "node:vm";
import ts from "typescript";

import * as continuity from "../lib/continuity.ts";
import * as network from "../lib/relationship-network.ts";
import { queueProjectServerSync } from "../lib/project-sync.ts";

const source = fs.readFileSync(new URL("../components/character-relationship-network.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("relationship-network.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compiled = ts.transpileModule(ast.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(ast)).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(complete) {
  const characters = ["林夏", "陈叔"].map((name, index) => ({
    id: `character.${index}`, name, role: index ? "证人" : "主角", description: "", background: "",
  }));
  return {
    id: "relationship-view", storyBibleVersion: 2, storyBibleStatus: "approved",
    characters, storyLines: [], generationSettings: { episodeCount: 2 },
    episodes: Array.from({ length: complete ? 2 : 1 }, (_, index) => ({
      episodeNumber: index + 1, status: "saved", workingDraftJson: JSON.stringify({
        title: "测试", characters, scenes: [{ scene_number: 1, dialogues: [], character_actions: ["林夏听陈叔说明交付来源。"] }],
      }),
    })),
    characterRelationships: [{ id: "relationship.body", sourceCharacterId: characters[0].id,
      targetCharacterId: characters[1].id, relationshipType: "证人与调查者", currentState: "已共同签字确认来源",
      episodeChanges: [{ episodeNumber: 1, summary: "共同签字" }], userEdited: false }],
  };
}

// Execute the real component's render, effects and event handlers without
// mounting a product page or persisting a project.
function harness(project, selectedRelationshipId = null, syncRetry = async () => ({ status: "synced" })) {
  const effects = [], writes = [], loads = [], retries = [];
  let stateIndex = 0;
  const stateValues = [null, selectedRelationshipId];
  let currentProject = project;
  const context = {
    exports: {}, ...continuity, ...network,
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
    useParams: () => ({ projectId: project.id }),
    useProjects: () => ({ getProject: () => currentProject, isReady: true,
      retryProjectSync: async (id) => {
        retries.push({ id, project: currentProject });
        return syncRetry(currentProject);
      },
      updateProject: async (id, patch) => {
        const resolvedPatch = typeof patch === "function" ? patch(currentProject) : patch;
        currentProject = { ...currentProject, ...resolvedPatch };
        writes.push({ id, patch: resolvedPatch });
        return true;
      } }),
    useLocale: () => ({ t: (key) => key }),
    useMemo: (factory) => factory(), useRef: (current) => ({ current }),
    useState: (initial) => {
      const index = stateIndex++;
      if (!(index in stateValues)) stateValues[index] = initial;
      return [stateValues[index], (value) => { stateValues[index] = typeof value === "function" ? value(stateValues[index]) : value; }];
    },
    useEffect: (effect) => effects.push(effect),
    loadStoryBible: async () => { loads.push(project.id); return { character_registry: [], relationships: [], character_arc_targets: [] }; },
    Link() {}, SectionHelp() {},
  };
  vm.createContext(context);
  vm.runInContext(compiled, context);
  return { writes, loads, effects, retries, render: () => {
    stateIndex = 0;
    return context.exports.CharacterRelationshipNetwork();
  } };
}

function elements(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}

for (const complete of [false, true]) {
  test(`viewing ${complete ? "complete" : "incomplete"} relationship data does not reseed or write the project`, async () => {
    const project = fixture(complete), before = structuredClone(project);
    const view = harness(project);
    view.render();
    for (const effect of view.effects) effect();
    await setImmediate();
    assert.deepEqual(view.writes, []);
    assert.deepEqual(view.loads, []);
    assert.deepEqual(project, before);
  });
}

test("an explicit relationship edit still writes the author's change and preserves episode history", () => {
  const project = fixture(true), before = structuredClone(project);
  const view = harness(project, "relationship.body");
  const rendered = view.render();
  const editor = elements(rendered).find((node) => node.type?.name === "RelationshipEditor");
  assert.ok(editor);
  const fields = elements(editor.type(editor.props));
  const currentState = fields.find((node) => node.type === "textarea" && node.props.value === "已共同签字确认来源");
  currentState.props.onChange({ target: { value: "作者更正的当前关系" } });
  assert.equal(view.writes.length, 1);
  const updated = view.writes[0].patch.characterRelationships[0];
  assert.equal(updated.currentState, "作者更正的当前关系");
  assert.equal(updated.userEdited, true);
  assert.deepEqual(updated.episodeChanges, project.characterRelationships[0].episodeChanges);
  assert.deepEqual(project, before);
});

test("successive edits from the same render preserve the latest relationship fields", () => {
  const project = fixture(true), before = structuredClone(project);
  const view = harness(project, "relationship.body");
  const editor = elements(view.render()).find((node) => node.type?.name === "RelationshipEditor");
  const fields = elements(editor.type(editor.props));
  const currentState = fields.find((node) => node.type === "textarea" && node.props.value === "已共同签字确认来源");
  const relationshipType = fields.find((node) => node.type === "input" && node.props.value === "证人与调查者");

  currentState.props.onChange({ target: { value: "已约定共同保护原件" } });
  relationshipType.props.onChange({ target: { value: "共同调查的伙伴" } });

  assert.equal(view.writes.length, 2);
  const updated = view.writes[1].patch.characterRelationships[0];
  assert.equal(updated.currentState, "已约定共同保护原件");
  assert.equal(updated.relationshipType, "共同调查的伙伴");
  assert.deepEqual(updated.episodeChanges, before.characterRelationships[0].episodeChanges);
  assert.deepEqual(project, before);
});

test("complete lists reach characters and relationships omitted from the graph without writing data", () => {
  const project = fixture(true);
  for (let index = 2; index < 9; index += 1) {
    project.characters.push({ ...project.characters[1], id: `character.${index}`, name: `配角${index}` });
    project.characterRelationships.push({ ...project.characterRelationships[0], id: `relationship.${index}`,
      targetCharacterId: `character.${index}`, episodeChanges: [] });
  }
  const before = structuredClone(project);
  assert.ok(!network.selectCoreRelationshipCharacters(project).some(item => item.character.id === "character.8"));
  const view = harness(project);
  const rendered = elements(view.render());
  const lists = rendered.filter(node => node.type === "ul" && node.props.className === "relationship-network-directory-list");
  const people = elements(lists[0]).filter(node => node.type === "a");
  const relationships = elements(lists[1]).filter(node => node.type === "a");
  assert.equal(people.length, 9);
  assert.equal(relationships.length, project.characterRelationships.length);
  assert.equal(people[8].props.href, "#relationship-network-detail");

  people[8].props.onClick();
  const characterView = elements(view.render());
  assert.ok(characterView.some(node => node.type === "h2" && node.props.children === "配角8"));
  const connected = characterView.find(node => node.props?.className === "relationship-network-connected");
  assert.equal(elements(connected).filter(node => node.type === "button").length, 1);

  relationships.at(-1).props.onClick();
  const relationView = elements(view.render());
  const editor = relationView.find(node => node.type?.name === "RelationshipEditor");
  assert.equal(editor.props.relationship.id, "relationship.8");
  assert.equal(relationView.find(node => node.props?.id === "relationship-network-detail").props.tabIndex, -1);
  assert.deepEqual(view.writes, []);
  assert.deepEqual(project, before);
});

test("relationship retry sends the latest add during server cooldown and still respects conflicts", async (t) => {
  const project = { ...fixture(true), title: "人物关系重试", status: "draft",
    createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z",
    serverSync: { status: "unavailable", projectRevision: 1, workspaceRevision: 1 } };
  project.characterRelationships.push({ ...project.characterRelationships[0], id: "relationship.added", relationshipType: "" });
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => "relationship-retry-client", setItem: () => {} } };
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  t.mock.method(Date, "now", () => Date.parse(project.updatedAt));
  let mode = "unavailable", attempts = 0, persisted;
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const path = new URL(input, "http://relationship-retry.test").pathname.replace(/^\/api/, "");
    if (path === `/story-projects/${project.id}`) {
      assert.equal(options.method ?? "GET", "GET");
      return Response.json({ data: { project_id: project.id, title: project.title, revision: 1,
        planned_episode_count: 2, status: "review" } });
    }
    assert.equal(path, `/story-projects/${project.id}/workspace`);
    if (options.method === "PUT") {
      attempts += 1;
      if (mode === "unavailable") return Response.json({ detail: "Offline" }, { status: 503 });
      if (mode === "conflict") return Response.json({ detail: "Newer workspace exists" }, { status: 409 });
      const payload = JSON.parse(options.body);
      persisted = payload.workspace_payload;
      return Response.json({ data: { revision: payload.revision, updated_at: persisted.updatedAt, workspace_payload: persisted } });
    }
    assert.equal(mode, "conflict");
    return Response.json({ data: { revision: 9, client_instance_id: "another-author",
      workspace_payload: { ...persisted, updatedAt: "2026-09-18T00:00:02.000Z" } } });
  });
  assert.equal((await queueProjectServerSync(project)).status, "unavailable");
  assert.equal(attempts, 1);
  mode = "available";
  assert.equal((await queueProjectServerSync(project)).status, "unavailable");
  assert.equal(attempts, 1, "automatic sync keeps its cooldown");

  let retryResult;
  const view = harness(project, "relationship.added", (latest) => {
    retryResult = queueProjectServerSync(latest, { bypassCooldown: true });
    return retryResult;
  });
  const editor = elements(view.render()).find(node => node.type?.name === "RelationshipEditor");
  const typeField = elements(editor.type(editor.props)).find(node => node.type === "input");
  typeField.props.onChange({ target: { value: "恢复同步后的关系" } });
  await setImmediate();
  const retry = elements(view.render()).find(node => node.type === "button" && node.props.children === "重试保存关系");
  assert.ok(retry);
  retry.props.onClick();
  await setImmediate();
  assert.ok(retryResult, "the component must use the explicit retry path");
  assert.equal((await retryResult).status, "synced");
  assert.equal(view.retries.length, 1);
  assert.equal(attempts, 2);
  assert.equal(persisted.characterRelationships.length, 2);
  assert.equal(persisted.characterRelationships[1].relationshipType, "恢复同步后的关系");
  assert.deepEqual(persisted.characterRelationships[0].episodeChanges, project.characterRelationships[0].episodeChanges);

  mode = "conflict";
  const beforeConflict = structuredClone(persisted);
  const result = await queueProjectServerSync({ ...project, updatedAt: "2026-09-18T00:00:01.000Z" }, { bypassCooldown: true });
  assert.equal(result.status, "conflict");
  assert.equal(attempts, 3, "manual retry must not force a second PUT over newer remote data");
  assert.deepEqual(persisted, beforeConflict);
});
