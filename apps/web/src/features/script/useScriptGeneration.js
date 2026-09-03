import { SCRIPT_OPERATION_CREDITS } from '@seqora/contracts'
import { isQueuedTextTask } from './scriptTaskState'

export function readGenerationResult(result) {
  const generatedScript = typeof result === 'string' ? result : result?.script
  if (!generatedScript?.trim()) throw new Error('模型没有返回有效剧本')
  return {
    script: generatedScript,
    warnings: typeof result === 'string' ? [] : result?.warnings || [],
  }
}

export function normalizeContentDuration(value, config) {
  return Math.min(
    config.maximumDuration,
    Math.max(config.minimumDuration, Math.round(Number(value) || config.defaultDuration)),
  )
}

export function useScriptGeneration({
  project,
  contentConfig,
  isSeries,
  productionMode,
  textProviderStatus,
  selectedScriptModelUnavailable,
  billing,
  script,
  direction,
  scriptModel,
  revisionNote,
  activeEpisode,
  orderedEpisodes,
  latestEpisode,
  saved,
  episodeDurationSeconds,
  segmentDurationSeconds,
  segmentGoal,
  onGenerate,
  onGenerateSegment,
  onSave,
  onSaveEpisode,
  onUpdateEpisodeDuration,
  onNext,
  suggestAssets,
  setActiveEpisodeId,
  setScript,
  setEpisodeDurationSeconds,
  setSegmentDurationSeconds,
  setRevisionNote,
  setSaved,
  setHasGeneratedScript,
  setGenerating,
  setGenerationPhase,
  setGenerationWarnings,
  setError,
  setSegmentGoal,
  setSaving,
}) {
  const textProviderError = (action) => {
    setError(
      textProviderStatus === 'unavailable'
        ? `当前文本模型暂不可用，请先配置文本 Provider 后再${action}。`
        : `暂时无法确认文本模型状态，请刷新页面后再${action}。`,
    )
  }

  const normalizeDuration = (value) => normalizeContentDuration(value, contentConfig)

  const commitEpisodeDuration = async () => {
    const next = normalizeDuration(episodeDurationSeconds)
    setEpisodeDurationSeconds(next)
    setSegmentDurationSeconds(next)
    if (next === project.episodeDurationSeconds || !onUpdateEpisodeDuration) return
    try {
      await onUpdateEpisodeDuration(next)
    } catch (durationError) {
      setError(durationError.message)
    }
  }

  const expand = async (intent = 'generate') => {
    if (textProviderStatus !== 'configured') {
      textProviderError('生成剧本')
      return
    }
    if (selectedScriptModelUnavailable) {
      setError('当前生成模型未在服务器配置，请选择其他可用模型。')
      return
    }
    if (intent === 'revise' && !revisionNote.trim()) {
      setError('请先填写希望修改或补充的内容')
      return
    }
    let targetEpisode = activeEpisode
    let sourceScript = script
    if (isSeries && intent === 'revise' && !targetEpisode) {
      targetEpisode = [...orderedEpisodes].sort(
        (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )[0]
      if (!targetEpisode) {
        setError('请先生成或填写第 1 集')
        return
      }
      sourceScript = targetEpisode.draftContent || targetEpisode.content
      setActiveEpisodeId(targetEpisode.id)
      setScript(sourceScript)
      setSaved(targetEpisode.status === 'saved')
    }
    if (billing.credits < SCRIPT_OPERATION_CREDITS.generate) {
      setError(
        `智能生成${contentConfig.documentName}需要 ${SCRIPT_OPERATION_CREDITS.generate} 积分，当前剩余 ${billing.credits} 积分`,
      )
      return
    }
    setGenerating(true)
    setGenerationPhase('quick')
    setGenerationWarnings([])
    setError('')
    try {
      const targetDurationSeconds = normalizeDuration(episodeDurationSeconds)
      setEpisodeDurationSeconds(targetDurationSeconds)
      const result = await onGenerate(
        sourceScript,
        direction,
        productionMode,
        targetDurationSeconds,
        scriptModel,
        intent === 'revise' ? revisionNote : '',
        setGenerationPhase,
        targetEpisode?.id,
      )
      if (isQueuedTextTask(result)) {
        setGenerationWarnings([
          `${contentConfig.documentName}已进入后台生成，可离开当前页面；完成或失败后会在右上角通知。`,
        ])
        return
      }
      const next = readGenerationResult(result)
      setScript(next.script)
      if (isSeries && result?.episode?.id) setActiveEpisodeId(result.episode.id)
      setHasGeneratedScript(true)
      setGenerationWarnings(next.warnings)
      setSaved(!isSeries)
      if (!isSeries) void suggestAssets(next.script)
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setGenerating(false)
      setGenerationPhase('idle')
    }
  }

  const generateSegment = async () => {
    if (textProviderStatus !== 'configured') {
      textProviderError('追加剧本')
      return
    }
    if (selectedScriptModelUnavailable) {
      setError('当前生成模型未在服务器配置，请选择其他可用模型。')
      return
    }
    const continuationEpisode = isSeries ? latestEpisode : null
    const continuationSource = isSeries
      ? continuationEpisode?.content || continuationEpisode?.draftContent || ''
      : script
    if (!continuationSource.trim() && !project.synopsis.trim()) {
      setError('请先填写故事简介或已有剧本段落')
      return
    }
    if (billing.credits < SCRIPT_OPERATION_CREDITS.generate) {
      setError(
        `${contentConfig.appendAction}需要 ${SCRIPT_OPERATION_CREDITS.generate} 积分，当前剩余 ${billing.credits} 积分`,
      )
      return
    }
    setGenerating(true)
    setGenerationPhase('segment')
    setGenerationWarnings([])
    setError('')
    try {
      const targetSegmentSeconds = normalizeDuration(segmentDurationSeconds)
      setSegmentDurationSeconds(targetSegmentSeconds)
      const result = await onGenerateSegment(
        continuationSource,
        direction,
        {
          goal: segmentGoal,
          targetSeconds: targetSegmentSeconds,
          targetMinutes: Math.max(1, Math.ceil(targetSegmentSeconds / 60)),
        },
        productionMode,
        episodeDurationSeconds,
        scriptModel,
        revisionNote,
        setGenerationPhase,
        continuationEpisode?.id,
      )
      if (isQueuedTextTask(result)) {
        setGenerationWarnings(['续写任务已进入后台，可继续浏览其他页面。'])
        setSegmentGoal('')
        return
      }
      const next = readGenerationResult(result)
      setScript(next.script)
      if (isSeries && result?.episode?.id) setActiveEpisodeId(result.episode.id)
      setHasGeneratedScript(true)
      setGenerationWarnings(next.warnings)
      setSaved(!isSeries)
      setSegmentGoal('')
      if (!isSeries) void suggestAssets(next.script)
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setGenerating(false)
      setGenerationPhase('idle')
    }
  }

  const save = async () => {
    if (!script.trim()) {
      setError('请先填写剧本内容')
      return false
    }
    setSaving(true)
    setError('')
    try {
      if (isSeries) {
        await onSaveEpisode(activeEpisode?.id || null, script)
        setActiveEpisodeId(null)
        setScript('')
        setRevisionNote('')
        setHasGeneratedScript(true)
      } else {
        await onSave(script)
      }
      setSaved(true)
      return true
    } catch (saveError) {
      setError(saveError.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  const continueToAssets = async () => {
    if (!saved && !(await save())) return
    onNext()
  }

  return { commitEpisodeDuration, expand, generateSegment, normalizeDuration, save, continueToAssets }
}
