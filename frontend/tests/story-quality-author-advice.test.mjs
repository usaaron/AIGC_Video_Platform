import assert from 'node:assert/strict';
import test from 'node:test';
import { storyPlanQualityFindingAdvice, storyPlanQualityRevisionMessage } from '../lib/story-quality-gate.ts';

test('author advice preserves the requested episode correction without exposing internal diagnostics', () => {
  const finding = {
    summary: '该节点为12集叶节点，逐集事件分配完整。',
    repair_instruction: '请修订第26集exit_state，删除“Viola的长期投药行为被侯爵察觉”；第28集exit_state删除“Cole目睹母亲害死父亲”。第29集因果节拍已明确Cole目睹母亲通敌害死父亲，该结果应在第29集实际发生后再写入exit_state。',
  };
  const original = structuredClone(finding);
  const advice = storyPlanQualityFindingAdvice(finding);
  assert.doesNotMatch(advice, /exit_state|叶节点|因果节拍/);
  for (const text of ['第26集退出状态', '第28集退出状态', '第29集实际发生后', 'Viola的长期投药行为被侯爵察觉', 'Cole目睹母亲害死父亲']) {
    assert.ok(advice.includes(text), text);
  }
  assert.deepEqual(finding, original, 'the stored review and instructions sent to the assistant stay intact');
});

test('older findings without repair instructions still show their actionable explanation', () => {
  assert.equal(storyPlanQualityFindingAdvice({ summary: '第36集entry_state缺少Eileen获知线索的依据。' }), '第36集进入状态缺少Eileen获知线索的依据。');
  assert.equal(storyPlanQualityFindingAdvice({ summary: '第38集需要补足公开证据。', repair_instruction: ' ' }), '第38集需要补足公开证据。');
  assert.equal(storyPlanQualityFindingAdvice({}), '请核对本段剧情并保存修改。');
});

test('temporary review references are translated only in author-facing advice', () => {
  const finding = {
    node_id: 'node.saved', node_version: 1, start_episode: 71, end_episode: 90, title: '皇城博弈',
    summary: 'review_4的前提和退出状态冲突。',
    repair_instruction: '请先修订review_4节点自身，保留第71–90集Eileen已获知的事实；review_5 节点也须承接第91集进入状态。',
  };
  const before = structuredClone(finding);
  assert.equal(storyPlanQualityFindingAdvice(finding),
    '请先修订这一部分自身，保留第71–90集Eileen已获知的事实；这一部分也须承接第91集进入状态。');
  assert.equal(storyPlanQualityFindingAdvice({summary: finding.summary}), '这一部分的前提和退出状态冲突。');
  const message = storyPlanQualityRevisionMessage({findings: [finding]});
  assert.match(message, /第71—90集「皇城博弈」/);
  assert.doesNotMatch(message, /review_\d+|节点/);
  assert.deepEqual(finding, before, 'raw findings and AI repair instructions retain exact IDs and facts');
  assert.equal(storyPlanQualityFindingAdvice({summary: 'preview_4与review_4_extra不是临时编号。'}),
    'preview_4与review_4_extra不是临时编号。');
});
