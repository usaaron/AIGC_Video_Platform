import { useEffect, useMemo } from 'react'
import { api } from '../../services/apiClient'

const BACKGROUND_TASK_POLL_MS = 30_000
const TRUSTED_PORTRAIT_POLL_MS = 8_000

export function processingTrustedPortraitRevision(assets) {
  return (assets || [])
    .filter(
      (asset) =>
        asset.attributes?.type === 'character' && asset.attributes.trustedPortrait?.status === 'processing',
    )
    .map((asset) => `${asset.id}:${asset.attributes.trustedPortrait.assetId}`)
    .sort()
    .join('|')
}

export function useTrustedPortraitSynchronization({ projectId, assets, setWorkspace }) {
  const processingRevision = useMemo(() => processingTrustedPortraitRevision(assets), [assets])

  useEffect(() => {
    if (!projectId || !processingRevision) return undefined
    let cancelled = false
    let requestInFlight = false
    let timer = null

    const schedule = (delay) => {
      if (cancelled) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void synchronize(), delay)
    }
    const synchronize = async () => {
      if (cancelled || requestInFlight) return
      requestInFlight = true
      try {
        const updatedAssets = await api.refreshProcessingTrustedPortraits(projectId)
        if (cancelled) return
        const byId = new Map(updatedAssets.map((asset) => [asset.id, asset]))
        setWorkspace((current) =>
          current?.project.id === projectId
            ? {
                ...current,
                assets: current.assets.map((asset) => byId.get(asset.id) || asset),
              }
            : current,
        )
      } catch {
        // A manual per-character refresh remains available when an upstream status check fails transiently.
      } finally {
        requestInFlight = false
        schedule(document.hidden ? BACKGROUND_TASK_POLL_MS : TRUSTED_PORTRAIT_POLL_MS)
      }
    }
    const handleVisibilityChange = () => {
      window.clearTimeout(timer)
      if (document.hidden) schedule(BACKGROUND_TASK_POLL_MS)
      else void synchronize()
    }

    void synchronize()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', synchronize)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', synchronize)
    }
  }, [processingRevision, projectId, setWorkspace])
}
