import { useEffect, useMemo, useRef, useState } from 'react'
import { assetSuggestionKey } from './AssetSuggestionsPanel'
import { suggestionToAssetInput } from './assetSuggestionInput'
import { isAssetSuggestionResult, isQueuedTextTask, scriptSuggestionFingerprint } from './scriptTaskState'

export function useAssetSuggestions({
  projectId,
  script,
  autoSource = '',
  scopeFingerprint = '',
  autoScopeFingerprint = '',
  direction,
  latestTask,
  activeTask,
  onSuggestAssets,
  onSuggestAssetsFast,
  onCreateAsset,
  onCreateAndGenerateAsset,
  onImportAssets,
  onCancelTask,
  stoppingTaskId,
  setStoppingTaskId,
}) {
  const [status, setStatus] = useState('idle')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [creatingKeys, setCreatingKeys] = useState(() => new Set())
  const [createdKeys, setCreatedKeys] = useState(() => new Set())
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set())
  const [editor, setEditor] = useState(null)
  const fastRequestRef = useRef(0)
  const automaticFingerprintRef = useRef('')
  const fastRequestModeRef = useRef(null)
  const pendingFastRequestRef = useRef(null)
  const observedTaskRef = useRef(null)
  const ignoredTaskRef = useRef(null)
  const automaticScope = autoSource.trim()
    ? autoScopeFingerprint || scriptSuggestionFingerprint(autoSource)
    : ''

  const reset = ({ preserveAutomatic = false } = {}) => {
    if (preserveAutomatic && fastRequestModeRef.current === 'automatic') return
    fastRequestRef.current += 1
    fastRequestModeRef.current = null
    pendingFastRequestRef.current = null
    setStatus('idle')
    setResult(null)
    setError('')
    setDismissedKeys(new Set())
  }

  useEffect(() => {
    automaticFingerprintRef.current = ''
    observedTaskRef.current = null
    ignoredTaskRef.current = null
    reset()
    setCreatingKeys(new Set())
    setCreatedKeys(new Set())
    setDismissedKeys(new Set())
    setEditor(null)
  }, [projectId])

  useEffect(() => {
    automaticFingerprintRef.current = ''
    reset()
    return () => {
      // Covers a changed/empty saved scope, a different project, and unmount.
      fastRequestRef.current += 1
      pendingFastRequestRef.current = null
    }
  }, [projectId, automaticScope])

  useEffect(() => {
    if (!latestTask) return
    const taskKey = `${projectId}:${latestTask.id}`
    if (ignoredTaskRef.current === taskKey) return
    if (observedTaskRef.current?.key !== taskKey) {
      observedTaskRef.current = { key: taskKey, scope: automaticScope, status: '' }
    }
    const observed = observedTaskRef.current
    // Polling returns new task objects. Only apply a status transition once,
    // and never restore a task first seen for an older saved scope.
    if (observed.scope !== automaticScope || observed.status === latestTask.status) return
    observed.status = latestTask.status
    automaticFingerprintRef.current = automaticScope
    fastRequestRef.current += 1
    pendingFastRequestRef.current = null
    fastRequestModeRef.current = 'manual'
    if (['queued', 'paused', 'running'].includes(latestTask.status)) {
      setStatus('suggesting')
      setError('')
      return
    }
    if (latestTask.status === 'completed') {
      const nextResult = latestTask.metadata?.textResult
      if (isAssetSuggestionResult(nextResult)) {
        setResult(nextResult)
        setError('')
      } else {
        setResult(null)
        setError('资产建议任务已完成，但没有返回有效结果，请重新分析。')
      }
      setStatus('ready')
      return
    }
    if (latestTask.status === 'failed') {
      setResult(null)
      setError(latestTask.error || '资产建议生成失败，请重试。')
      setStatus('ready')
      return
    }
    if (latestTask.status === 'cancelled') {
      setResult(null)
      setError('')
      setStatus((current) => (current === 'extracting' ? current : 'idle'))
    }
  }, [latestTask, projectId, automaticScope])

  const suggest = async (value) => {
    const source = value.trim()
    if (!source) return
    const requestId = ++fastRequestRef.current
    fastRequestModeRef.current = 'manual'
    pendingFastRequestRef.current = null
    setStatus('suggesting')
    setResult(null)
    setError('')
    setDismissedKeys(new Set())
    try {
      const task = await onSuggestAssets(
        source,
        direction,
        scopeFingerprint || scriptSuggestionFingerprint(source),
      )
      if (fastRequestRef.current !== requestId) return
      if (!isQueuedTextTask(task)) {
        const cachedResult = task?.metadata?.textResult
        setResult(cachedResult && typeof cachedResult === 'object' ? cachedResult : task)
        setStatus('ready')
      }
      setCreatedKeys(new Set())
    } catch (suggestError) {
      if (fastRequestRef.current !== requestId) return
      setError(suggestError.message)
      setStatus('ready')
    }
  }

  const stop = async () => {
    if (!activeTask || !onCancelTask || stoppingTaskId) return
    setStoppingTaskId(activeTask.id)
    setError('')
    try {
      await onCancelTask(activeTask.id, '已停止资产分析，其他剧本任务可继续运行')
      setStatus('idle')
      setResult(null)
    } catch (stopError) {
      setError(stopError.message)
    } finally {
      setStoppingTaskId(null)
    }
  }

  const runFastExtraction = async (value, cancelActiveTask = false) => {
    const source = value.trim()
    if (!source || !onSuggestAssetsFast || stoppingTaskId) return
    const requestKey = JSON.stringify([projectId, automaticScope, source, direction])
    if (pendingFastRequestRef.current?.key === requestKey) return
    const requestId = fastRequestRef.current + 1
    fastRequestRef.current = requestId
    fastRequestModeRef.current = cancelActiveTask ? 'manual' : 'automatic'
    if (cancelActiveTask) automaticFingerprintRef.current = automaticScope
    pendingFastRequestRef.current = { id: requestId, key: requestKey }
    setStatus('extracting')
    setResult(null)
    setError('')
    setDismissedKeys(new Set())
    try {
      if (cancelActiveTask && activeTask && onCancelTask) {
        const taskKey = `${projectId}:${activeTask.id}`
        const previousIgnoredTask = ignoredTaskRef.current
        ignoredTaskRef.current = taskKey
        setStoppingTaskId(activeTask.id)
        try {
          await onCancelTask(activeTask.id, '已切换为剧本快速提取')
        } catch (cancelError) {
          // Cancellation failed, so the model task may still finish. Resume
          // accepting its updates without undoing a newer request's marker.
          if (ignoredTaskRef.current === taskKey) ignoredTaskRef.current = previousIgnoredTask
          throw cancelError
        }
      }
      if (fastRequestRef.current !== requestId) return
      const nextResult = await onSuggestAssetsFast(source, direction)
      if (!isAssetSuggestionResult(nextResult)) throw new Error('快速提取没有返回有效资产，请重试')
      if (fastRequestRef.current !== requestId) return
      setResult(nextResult)
      setStatus('ready')
      setCreatedKeys(new Set())
    } catch (extractError) {
      if (fastRequestRef.current !== requestId) return
      setError(extractError.message)
      setStatus('ready')
    } finally {
      if (pendingFastRequestRef.current?.id === requestId) pendingFastRequestRef.current = null
      if (cancelActiveTask) setStoppingTaskId(null)
    }
  }

  const extractFast = () => runFastExtraction(script, true)

  useEffect(() => {
    const source = autoSource.trim()
    if (!source || !onSuggestAssetsFast || activeTask || stoppingTaskId) return
    if (automaticFingerprintRef.current === automaticScope) return
    // Record attempts as well as successes: a failed scan can be retried by the
    // user, but unrelated renders must not create an automatic retry loop.
    automaticFingerprintRef.current = automaticScope
    void runFastExtraction(source)
  }, [projectId, autoSource, automaticScope, activeTask?.id, onSuggestAssetsFast, stoppingTaskId])

  const openEditor = (asset) => {
    const key = assetSuggestionKey(asset)
    setError('')
    setEditor({
      kind: asset.kind,
      suggestion: asset,
      suggestionKey: key,
      editorKey: crypto.randomUUID(),
    })
  }

  const createAndGenerate = async (asset) => {
    if (!onCreateAndGenerateAsset) return
    const key = assetSuggestionKey(asset)
    setCreatingKeys((current) => new Set(current).add(key))
    setError('')
    try {
      await onCreateAndGenerateAsset(suggestionToAssetInput(asset))
      setCreatedKeys((current) => new Set(current).add(key))
      return true
    } catch (generationError) {
      setError(generationError.message)
      return false
    } finally {
      setCreatingKeys((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    }
  }

  const importSelected = async (suggestions) => {
    if (!onImportAssets && !onCreateAsset) return
    setError('')
    try {
      const inputs = suggestions.map(suggestionToAssetInput)
      if (onImportAssets) await onImportAssets(inputs)
      else {
        for (const input of inputs) await onCreateAsset(input)
      }
      setCreatedKeys((current) => {
        const next = new Set(current)
        suggestions.forEach((suggestion) => next.add(assetSuggestionKey(suggestion)))
        return next
      })
      return true
    } catch (importError) {
      setError(importError.message)
      return false
    }
  }

  const generateSelected = async (suggestions) => {
    for (const suggestion of suggestions) {
      if (!(await createAndGenerate(suggestion))) break
    }
  }

  const cancelBeforeContinue = async () => {
    if (!activeTask || !onCancelTask) return true
    try {
      setStoppingTaskId(activeTask.id)
      await onCancelTask(activeTask.id, '已跳过资产建议')
      return true
    } catch (skipError) {
      setError(skipError.message)
      return false
    } finally {
      setStoppingTaskId(null)
    }
  }

  const markEditorAssetCreated = () => {
    if (!editor) return
    setCreatedKeys((current) => new Set(current).add(editor.suggestionKey))
    setEditor(null)
  }

  const dismissSuggestion = (asset) => {
    const key = assetSuggestionKey(asset)
    setDismissedKeys((current) => new Set(current).add(key))
    setEditor((current) => (current?.suggestionKey === key ? null : current))
  }

  const visibleResult = useMemo(() => {
    if (!result) return result
    return {
      ...result,
      assets: result.assets.filter((asset) => !dismissedKeys.has(assetSuggestionKey(asset))),
    }
  }, [dismissedKeys, result])

  return {
    status: activeTask && status === 'idle' ? 'suggesting' : status,
    result: visibleResult,
    error,
    creatingKeys,
    createdKeys,
    editor,
    reset,
    suggest,
    stop,
    extractFast,
    openEditor,
    createAndGenerate,
    importSelected,
    generateSelected,
    cancelBeforeContinue,
    closeEditor: () => setEditor(null),
    markEditorAssetCreated,
    dismissSuggestion,
  }
}
