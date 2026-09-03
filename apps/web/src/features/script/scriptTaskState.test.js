import { describe, expect, it } from 'vitest'
import {
  assetSuggestionRevision,
  commonPrefix,
  deriveScriptTaskState,
  formatEpisodeDuration,
  isAssetSuggestionResult,
  isQueuedTextTask,
  scriptResultText,
  scriptSuggestionFingerprint,
  scriptTaskOperation,
  scriptTaskStatusPriority,
  taskTimestamp,
  textPreviewStageLabel,
} from './scriptTaskState'

describe('script task state', () => {
  it('orders active states by execution priority', () => {
    expect(['failed', 'paused', 'queued', 'running'].map(scriptTaskStatusPriority)).toEqual([0, 1, 2, 3])
  })

  it('reads generated script and segment payloads', () => {
    expect(scriptResultText({ metadata: { textResult: { script: '  剧本  ' } } })).toBe('剧本')
    expect(scriptResultText({ metadata: { textResult: { segment: '  续写  ' } } })).toBe('续写')
    expect(scriptResultText({ metadata: { textResult: null } })).toBe('')
  })

  it('classifies operations without trusting only the task label', () => {
    expect(scriptTaskOperation({ metadata: { mode: 'segment' } })).toBe('segment')
    expect(scriptTaskOperation({ metadata: { scriptOperation: 'enrich' } })).toBe('revise')
    expect(scriptTaskOperation({ metadata: { scriptOperation: 'generate', revisionNote: '加强冲突' } })).toBe(
      'revise',
    )
    expect(scriptTaskOperation({ metadata: { scriptOperation: 'generate' } })).toBe('generate')
  })

  it('keeps fingerprints and asset revisions deterministic', () => {
    expect(scriptSuggestionFingerprint('  同一剧本  ')).toBe(scriptSuggestionFingerprint('同一剧本'))
    expect(scriptSuggestionFingerprint('剧本甲')).not.toBe(scriptSuggestionFingerprint('剧本乙'))
    expect(
      assetSuggestionRevision([
        { id: 'b', updatedAt: '2' },
        { id: 'a', updatedAt: '1' },
      ]),
    ).toBe('a:1|b:2')
  })

  it('formats duration, preview stages, and shared task guards', () => {
    expect(formatEpisodeDuration(65)).toBe('1 分 5 秒')
    expect(formatEpisodeDuration(30)).toBe('30 秒')
    expect(textPreviewStageLabel('structure-repair')).toBe('正在修复场次结构')
    expect(isQueuedTextTask({ kind: 'text', status: 'running' })).toBe(true)
    expect(isQueuedTextTask({ kind: 'image', status: 'running' })).toBe(false)
    expect(isAssetSuggestionResult({ summary: 'ok', assets: [] })).toBe(true)
    expect(commonPrefix('场次一结束', '场次一开始')).toBe('场次一')
    expect(taskTimestamp({ updatedAt: 'invalid' })).toBe(0)
  })
})

describe('derived script task state', () => {
  const baseTask = {
    id: 'task-1',
    clientRequestId: 'request-1',
    projectId: 'project-1',
    kind: 'text',
    status: 'running',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:01.000Z',
    metadata: { generationStage: 'script-generate', scriptOperation: 'generate' },
  }

  it('ignores tasks from other projects and selects the highest-priority active task', () => {
    const state = deriveScriptTaskState({
      tasks: [
        { ...baseTask, id: 'other', projectId: 'project-2' },
        { ...baseTask, id: 'queued', status: 'queued' },
        baseTask,
      ],
      projectId: 'project-1',
      orderedEpisodes: [],
      assetSuggestionFingerprint: '0:0',
      currentAssetRevision: 'none',
    })

    expect(state.activeScriptTask).toBe(baseTask)
    expect(state.activeGenerateTask).toBe(baseTask)
  })

  it('releases the editor as soon as the matching episode draft is durable', () => {
    const episode = {
      id: 'episode-1',
      episodeNumber: 1,
      status: 'draft',
      draftContent: '已经写回的剧本',
      updatedAt: '2026-09-03T00:00:02.000Z',
      continuityState: { generationClientRequestId: 'request-1' },
    }
    const state = deriveScriptTaskState({
      tasks: [baseTask],
      projectId: 'project-1',
      orderedEpisodes: [episode],
      assetSuggestionFingerprint: '0:0',
      currentAssetRevision: 'none',
    })

    expect(state.activeTaskHasWriteback).toBe(true)
    expect(state.activeTaskDraftText).toBe('已经写回的剧本')
    expect(state.activeScriptTask).toBeNull()
  })

  it('matches asset suggestions to both script and asset revisions', () => {
    const suggestion = {
      ...baseTask,
      id: 'suggestion',
      status: 'running',
      metadata: {
        generationStage: 'script-asset-suggestions',
        scriptOperation: 'suggest-assets',
        sourceScriptFingerprint: '10:abc',
        assetRevision: 'asset:1',
      },
    }
    const state = deriveScriptTaskState({
      tasks: [suggestion],
      projectId: 'project-1',
      orderedEpisodes: [],
      assetSuggestionFingerprint: '10:abc',
      currentAssetRevision: 'asset:1',
    })

    expect(state.activeAssetSuggestionTask).toBe(suggestion)
    expect(state.activeScriptTask).toBeUndefined()
  })
})
