import { useEffect, useState } from 'react'
import { hasCompletedVideoForShot } from '../generation/taskResults'

export function useShotPlayback({ workspace, tasks }) {
  const [playing, setPlaying] = useState(false)
  const [currentShot, setCurrentShot] = useState(0)
  const currentShotId = workspace?.shots[currentShot]?.id
  const currentShotHasVideo = Boolean(currentShotId && hasCompletedVideoForShot(tasks, currentShotId))

  useEffect(() => {
    if (!playing || !workspace?.shots.length) return undefined
    if (currentShotHasVideo) return undefined
    const timer = window.setInterval(
      () => setCurrentShot((index) => (index + 1) % workspace.shots.length),
      2_400,
    )
    return () => window.clearInterval(timer)
  }, [currentShotHasVideo, playing, workspace?.shots.length])

  return {
    playing,
    setPlaying,
    currentShot,
    setCurrentShot,
  }
}
