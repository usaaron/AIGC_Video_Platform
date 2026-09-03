import { useEffect, useState } from 'react'
import { assetSuggestionKey } from './AssetSuggestionsPanel'
import { suggestionToAssetInput } from './assetSuggestionInput'
import { isAssetSuggestionResult, isQueuedTextTask, scriptSuggestionFingerprint } from './scriptTaskState'

export function useAssetSuggestions({
  projectId,
  script,
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
  const [editor, setEditor] = useState(null)

  const reset = () => {
    setStatus('idle')
    setResult(null)
    setError('')
  }

  useEffect(() => {
    reset()
    setCreatingKeys(new Set())
    setCreatedKeys(new Set())
    setEditor(null)
  }, [projectId])

  useEffect(() => {
    if (!latestTask) return
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
  }, [latestTask])

  const suggest = async (value) => {
    const source = value.trim()
    if (!source) return
    setStatus('suggesting')
    setResult(null)
    setError('')
    try {
      const task = await onSuggestAssets(source, direction, scriptSuggestionFingerprint(source))
      if (!isQueuedTextTask(task)) {
        const cachedResult = task?.metadata?.textResult
        setResult(cachedResult && typeof cachedResult === 'object' ? cachedResult : task)
        setStatus('ready')
      }
      setCreatedKeys(new Set())
    } catch (suggestError) {
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

  const extractFast = async () => {
    const source = script.trim()
    if (!source || !onSuggestAssetsFast || stoppingTaskId) return
    setStatus('extracting')
    setResult(null)
    setError('')
    try {
      if (activeTask && onCancelTask) {
        setStoppingTaskId(activeTask.id)
        await onCancelTask(activeTask.id, '已切换为剧本快速提取')
      }
      const nextResult = await onSuggestAssetsFast(source, direction)
      if (!isAssetSuggestionResult(nextResult)) throw new Error('快速提取没有返回有效资产，请重试')
      setResult(nextResult)
      setStatus('ready')
      setCreatedKeys(new Set())
    } catch (extractError) {
      setError(extractError.message)
      setStatus('ready')
    } finally {
      setStoppingTaskId(null)
    }
  }

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
    } catch (generationError) {
      setError(generationError.message)
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
    } catch (importError) {
      setError(importError.message)
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

  return {
    status: activeTask && status === 'idle' ? 'suggesting' : status,
    result,
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
    cancelBeforeContinue,
    closeEditor: () => setEditor(null),
    markEditorAssetCreated,
  }
}
