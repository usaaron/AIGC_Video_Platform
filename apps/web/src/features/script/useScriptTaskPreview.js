import { useEffect, useRef, useState } from 'react'
import { commonPrefix } from './scriptTaskState'

export function previewCatchupStep(currentText, targetText) {
  const remaining = targetText.length - currentText.length
  const step = remaining > 1_200 ? 6 : remaining > 400 ? 3 : 1
  return targetText.slice(0, Math.min(targetText.length, currentText.length + step))
}

export function useScriptTaskPreview({
  activePreviewSessionKey,
  activeTextPreview,
  completedScriptText,
  hasActiveScriptTask,
}) {
  const [previewState, setPreviewState] = useState(() => ({
    key: activePreviewSessionKey,
    text: activeTextPreview,
  }))
  const previewTextRef = useRef({ key: activePreviewSessionKey, text: activeTextPreview })
  const previewTimerRef = useRef(null)
  const previewContentRef = useRef(null)
  const displayedTextPreview = previewState.key === activePreviewSessionKey ? previewState.text : ''

  const clearPreviewAnimation = () => {
    if (previewTimerRef.current === null) return
    window.clearInterval(previewTimerRef.current)
    previewTimerRef.current = null
  }

  useEffect(() => {
    if (!hasActiveScriptTask) {
      clearPreviewAnimation()
      const text = completedScriptText || ''
      previewTextRef.current = { key: activePreviewSessionKey, text }
      setPreviewState({ key: activePreviewSessionKey, text })
      return undefined
    }

    clearPreviewAnimation()
    const current = previewTextRef.current
    const base =
      current.key === activePreviewSessionKey && activeTextPreview.startsWith(current.text)
        ? current.text
        : current.key === activePreviewSessionKey
          ? commonPrefix(current.text, activeTextPreview)
          : ''
    previewTextRef.current = { key: activePreviewSessionKey, text: base }
    setPreviewState({ key: activePreviewSessionKey, text: base })
    if (!activeTextPreview.trim() || base === activeTextPreview) return undefined

    const timer = window.setInterval(() => {
      const currentText = previewTextRef.current
      if (currentText.key !== activePreviewSessionKey || currentText.text === activeTextPreview) {
        window.clearInterval(timer)
        if (previewTimerRef.current === timer) previewTimerRef.current = null
        return
      }
      const nextText = previewCatchupStep(currentText.text, activeTextPreview)
      previewTextRef.current = { key: activePreviewSessionKey, text: nextText }
      setPreviewState({ key: activePreviewSessionKey, text: nextText })
    }, 8)
    previewTimerRef.current = timer

    return () => {
      window.clearInterval(timer)
      if (previewTimerRef.current === timer) previewTimerRef.current = null
    }
  }, [activePreviewSessionKey, activeTextPreview, completedScriptText, hasActiveScriptTask])

  useEffect(() => {
    const previewElement = previewContentRef.current
    if (previewElement) previewElement.scrollTop = previewElement.scrollHeight
  }, [displayedTextPreview])

  return { clearPreviewAnimation, displayedTextPreview, previewContentRef }
}
