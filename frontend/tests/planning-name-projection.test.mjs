import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { planningCharacterNameFormatter } from '../lib/canonical-character-names.ts';

const project = {
  id: 'project', generationSettings: { releaseRegion: 'overseas' },
  canonicalCharacterNames: { 莉娜: 'Lena', 诺亚: 'Noah', 琼: 'June', 梅: 'May', 乔: 'Jo' },
};
const format = planningCharacterNameFormatter(project);
test('approved identity display is read-only and preserves unknown words and ambiguous single-character prose', () => {
  const node = { node_id: 'node.lena', version: 2, parent_node_id: 'root', parent_node_version: 1,
    exit_state: '莉娜搬家，诺亚留下，琼（June）关灯；梅花落在乔木下。',
    character_refs: ['character.lena', 'character.noah'],
  };
  const before = structuredClone({ project, node });
  assert.equal(format(node.exit_state), 'Lena搬家，Noah留下，June关灯；梅花落在乔木下。');
  assert.equal(format('琼'), 'June');
  assert.equal(format('Mason closes the door.'), 'Mason closes the door.');
  assert.equal(format('无明确映射的名字保持原文。'), '无明确映射的名字保持原文。');
  assert.deepEqual({ project, node }, before);
  assert.equal(planningCharacterNameFormatter({ ...project, generationSettings: { releaseRegion: 'cn_mainland' } })(node.exit_state), node.exit_state);
});

const source = await readFile(new URL('../components/story-plan-node-panel.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['PlanField', 'PlanListField', 'InlinePlanningText']);
const declarations = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) declarations.push(node.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
const compiled = ts.transpileModule(declarations.join('\n'), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React,
  jsxFactory: 'element', jsxFragmentFactory: 'fragment',
} }).outputText;
const element = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) });
const components = new Function('useContext', 'useState', 'PlanningNameDisplayContext', 'element', 'fragment',
  `${compiled}\nreturn {PlanField,PlanListField,InlinePlanningText};`)(() => format, () => [null, () => {}], {}, element, 'fragment');
function descendants(tree) {
  return typeof tree === 'object' && tree ? [tree, ...tree.children.flatMap(descendants)] : [];
}
for (const name of names) {
  test(`${name} displays English but focus/blur cannot silently rewrite an approved Chinese source`, () => {
    const raw = '莉娜看向诺亚。'; const changes = [];
    const props = { editing: false, locked: false, label: '剧情', value: raw, values: [raw, '其他既有事实'], onChange: value => changes.push(value) };
    const before = structuredClone({ value: props.value, values: props.values });
    const view = components[name](props);
    const field = descendants(view).find(item => item.props.onBlur);
    assert.ok(field); assert.equal(field.props.contentEditable, true);
    assert.equal(field.children.join(''), 'Lena看向Noah。');
    field.props.onBlur({ currentTarget: { textContent: 'Lena看向Noah。' } });
    assert.deepEqual(changes, []);
    assert.deepEqual({ value: props.value, values: props.values }, before);
    field.props.onBlur({ currentTarget: { textContent: 'Lena明确拒绝。' } });
    assert.deepEqual(changes, [name === 'PlanListField' ? ['Lena明确拒绝。', '其他既有事实'] : 'Lena明确拒绝。']);
    const locked = descendants(components[name]({ ...props, locked: true })).find(item => item.props.onBlur);
    assert.equal(locked.props.contentEditable, false);
  });
}
