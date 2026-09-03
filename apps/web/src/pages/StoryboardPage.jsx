import { useEffect, useMemo, useState } from 'react'
import JSZip from 'jszip'
import {
  ArrowRight,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  Film,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Scissors,
  Video,
  Zap,
} from 'lucide-react'
import { IconButton, PageHeader } from '../components/ui'
import { ShotEditor, ShotHistoryModal, ShotRow } from '../features/storyboard/StoryboardComponents'
import {
  createShotAssetReferenceIndex,
  selectShotAssetReferencesFromIndex,
} from '../features/storyboard/referenceSelector'
import { VIDEO_RESOLUTIONS } from '../features/storyboard/storyboardConstants'
import {
  addStoryboardVideosToArchive,
  episodeKey,
  episodeKeyForShot,
  groupShotsByEpisode,
  isActive,
  selectedVersionTaskId,
  taskFor,
  taskById,
  taskOutputUrl,
  videoResolutionForTask,
} from '../features/storyboard/storyboardState'
import { activeVideoTasksForShots, planVideoBatch } from '../features/storyboard/videoBatchPlanner'
import { normalizedVideoDuration } from '@seqora/prompting'

export function StoryboardPage({
  project,
  scriptEpisodes = [],
  shots,
  assets,
  tasks,
  episodeDurationSeconds: projectEpisodeDurationSeconds = 60,
  onUpdateEpisodeDuration,
  concurrency = 1,
  unlimitedConcurrency = false,
  onRegenerate,
  onAutoSplitEpisodes,
  onCreate,
  onUpdate,
  onDelete,
  onUpload,
  onGenerateVideo,
  onGenerateAllVideos,
  onNext,
}) {
  const [selected, setSelected] = useState(shots[0]?.id)
  const [editing, setEditing] = useState(null)
  const [historyShotId, setHistoryShotId] = useState(null)
  const [batchResolution, setBatchResolution] = useState('720p')
  const [batchMode, setBatchMode] = useState('parallel')
  const [episodeDuration, setEpisodeDuration] = useState(projectEpisodeDurationSeconds)
  const [shotResolutions, setShotResolutions] = useState({})
  const [splitting, setSplitting] = useState('')
  const [splittingEpisodes, setSplittingEpisodes] = useState(false)
  const [generatingAll, setGeneratingAll] = useState(false)
  const [operationError, setOperationError] = useState('')
  const [operationNotice, setOperationNotice] = useState('')
  const [downloadingVideos, setDownloadingVideos] = useState(false)
  const [deletingShotId, setDeletingShotId] = useState('')
  const isWebSeries = project?.contentType === 'short-drama'
  const shotMinDuration = isWebSeries ? 3 : 4
  const episodes = useMemo(
    () => groupShotsByEpisode(shots, shotMinDuration, scriptEpisodes),
    [shots, shotMinDuration, scriptEpisodes],
  )
  const assetIndex = useMemo(() => createShotAssetReferenceIndex(assets), [assets])
  const shotReferences = useMemo(
    () =>
      new Map(
        shots.map((shot) => [shot.id, selectShotAssetReferencesFromIndex(assetIndex, shot, 6, assets)]),
      ),
    [assetIndex, assets, shots],
  )
  const [selectedEpisode, setSelectedEpisode] = useState(
    () => episodeKeyForShot(shots[0]) || (episodes[0] ? episodeKey(episodes[0]) : 'all'),
  )
  const visibleEpisodes = useMemo(
    () =>
      selectedEpisode === 'all'
        ? episodes
        : episodes.filter((episode) => episodeKey(episode) === selectedEpisode),
    [episodes, selectedEpisode],
  )
  const selectedEpisodeIndex = useMemo(
    () => episodes.findIndex((episode) => episodeKey(episode) === selectedEpisode),
    [episodes, selectedEpisode],
  )
  const currentEpisode = selectedEpisode === 'all' ? null : episodes[selectedEpisodeIndex] || null
  const hasScriptEpisodeWorkflow = useMemo(
    () => episodes.some((episode) => Boolean(episode.scriptEpisodeId)),
    [episodes],
  )
  const rangeShots = useMemo(
    () => (selectedEpisode === 'all' ? shots : visibleEpisodes.flatMap((episode) => episode.shots)),
    [selectedEpisode, shots, visibleEpisodes],
  )
  const activeBatchTasks = useMemo(() => activeVideoTasksForShots(tasks, rangeShots), [tasks, rangeShots])
  const batchLocked = activeBatchTasks.length > 0
  const controlsLocked = batchLocked || Boolean(splitting) || splittingEpisodes || generatingAll
  const activeShotCount = new Set(activeBatchTasks.map((task) => task.metadata?.shotId)).size
  const totalDuration = useMemo(
    () => rangeShots.reduce((sum, shot) => sum + normalizedVideoDuration(shot.duration, shotMinDuration), 0),
    [rangeShots, shotMinDuration],
  )
  const batchPlan = useMemo(
    () => planVideoBatch(rangeShots, batchMode, concurrency),
    [rangeShots, batchMode, concurrency],
  )
  const continuityPointCount = useMemo(
    () => visibleEpisodes.reduce((count, episode) => count + Math.max(0, episode.shots.length - 1), 0),
    [visibleEpisodes],
  )
  const historyShot = shots.find((shot) => shot.id === historyShotId) || null
  const downloadableVideos = useMemo(
    () =>
      rangeShots.flatMap((shot) => {
        const taskId = selectedVersionTaskId(tasks, shot, 'video')
        const task = taskById(tasks, taskId)
        const url = task?.status === 'completed' ? taskOutputUrl(task, 'video') : null
        return task && url ? [{ shot, task, url }] : []
      }),
    [rangeShots, tasks],
  )

  useEffect(() => {
    setEpisodeDuration(projectEpisodeDurationSeconds)
  }, [project?.id, projectEpisodeDurationSeconds])

  useEffect(() => {
    if (selectedEpisode === 'all') return
    if (!episodes.some((episode) => episodeKey(episode) === selectedEpisode)) {
      setSelectedEpisode(episodes[0] ? episodeKey(episodes[0]) : 'all')
    }
  }, [episodes, selectedEpisode])

  const splitFromScript = async (mode, episodeOverride = null) => {
    if (controlsLocked) return
    const targetEpisode = episodeOverride || currentEpisode
    setSplitting(mode)
    setOperationError('')
    setOperationNotice('')
    try {
      const generatedShots = await onRegenerate(mode, episodeDuration, targetEpisode?.scriptEpisodeId)
      const generatedCount = Array.isArray(generatedShots) ? generatedShots.length : 0
      if (generatedCount) {
        setOperationNotice(
          mode === 'beat'
            ? `已批量拆分 ${generatedCount} 个动作镜头`
            : `已扫描完整剧本，批量生成 ${generatedCount} 个分镜`,
        )
      }
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setSplitting('')
    }
  }

  const autoSplitEpisodes = async () => {
    if (controlsLocked || !shots.length) return
    setSplittingEpisodes(true)
    setOperationError('')
    setOperationNotice('')
    try {
      await onAutoSplitEpisodes(episodeDuration)
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setSplittingEpisodes(false)
    }
  }

  const generateAll = async (mode = batchMode) => {
    if (controlsLocked) return
    if (
      mode === 'parallel' &&
      !window.confirm('安全并发只会同时生成互相独立的镜头链；同一链内仍会等待上一镜真实尾帧。确认开始吗？')
    )
      return
    if (
      mode === 'independent' &&
      !window.confirm('全部独立生成会取消所有镜头的尾帧承接关系，速度更快，但镜头连续性会降低。确认继续吗？')
    )
      return
    setGeneratingAll(true)
    setOperationError('')
    setOperationNotice('')
    try {
      await onGenerateAllVideos(rangeShots, batchResolution, mode)
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setGeneratingAll(false)
    }
  }

  const downloadCompletedVideos = async () => {
    if (!downloadableVideos.length || downloadingVideos) return
    setDownloadingVideos(true)
    setOperationError('')
    setOperationNotice('')
    try {
      const zip = new JSZip()
      const { successCount, failures } = await addStoryboardVideosToArchive(zip, downloadableVideos)
      if (!successCount) {
        throw new Error(
          `没有可下载的视频；${failures.length} 条已完成记录的源文件暂不可用，请重新生成后再试。`,
        )
      }
      const archive = await zip.generateAsync({
        type: 'blob',
        // MP4 is already compressed. Re-compressing it only burns CPU and delays the download.
        compression: 'STORE',
      })
      downloadBlob(archive, `${safeFileName(project.name || '序幕TV项目')}-分镜视频.zip`)
      setOperationNotice(
        failures.length
          ? `已打包 ${successCount} 条视频，另有 ${failures.length} 条源文件暂不可用，详情已写入压缩包。`
          : `已打包 ${successCount} 条视频。`,
      )
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setDownloadingVideos(false)
    }
  }

  const latestEpisode = episodes.at(-1)
  const newShotDraft = (
    episodeNumber = currentEpisode?.number || latestEpisode?.number || 1,
    forceNewEpisode = false,
  ) => {
    const targetEpisode = currentEpisode || latestEpisode
    return {
      title: forceNewEpisode ? `第 ${episodeNumber} 集 · 开场镜头` : `镜头 ${shots.length + 1}`,
      framing: '中景',
      duration: shotMinDuration,
      prompt: '',
      negativePrompt: '',
      imageUrl: null,
      scriptEpisodeId: forceNewEpisode ? null : targetEpisode?.scriptEpisodeId || null,
      continuityMode: forceNewEpisode || !targetEpisode?.shots.length ? 'independent' : 'continue',
      continuityNote: '',
      episodeBreakBefore: forceNewEpisode,
      episodeNumber,
      episodeTitle: forceNewEpisode
        ? `第 ${episodeNumber} 集`
        : targetEpisode?.title || `第 ${episodeNumber} 集`,
      episodeKind: 'standard',
    }
  }

  const deleteShot = async (shot) => {
    const videoTask = taskFor(tasks, shot, 'video')
    if (isActive(videoTask) || deletingShotId) return
    if (!window.confirm(`确认删除“${shot.title}”吗？后续镜头会自动重新编号，已完成的视频历史不会被删除。`)) {
      return
    }
    setDeletingShotId(shot.id)
    setOperationError('')
    try {
      await onDelete(shot.id)
      if (selected === shot.id) setSelected(null)
    } catch (error) {
      setOperationError(error.message)
    } finally {
      setDeletingShotId('')
    }
  }

  return (
    <div className="page storyboard-page">
      <PageHeader
        eyebrow="第 3 步 · 分镜"
        title="一眼看清整段影片"
        description="分镜已保存到项目，可以调整画面、提示词和时长。"
      >
        <button
          className="button secondary"
          onClick={() => void splitFromScript('scene')}
          disabled={controlsLocked}
          title={
            currentEpisode
              ? `只重新生成第 ${currentEpisode.number} 集分镜，不影响其他集`
              : '扫描全部已保存剧集并按场次批量生成分镜'
          }
        >
          {splitting === 'scene' ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
          {splitting === 'scene'
            ? currentEpisode
              ? `正在生成第 ${currentEpisode.number} 集`
              : '正在批量拆分全部剧集'
            : currentEpisode
              ? `生成第 ${currentEpisode.number} 集分镜`
              : '生成全部剧集分镜'}
        </button>
        <button
          className="button secondary"
          onClick={() => void splitFromScript('beat')}
          disabled={controlsLocked}
        >
          {splitting === 'beat' ? <LoaderCircle size={16} className="spin" /> : <Scissors size={16} />}
          {splitting === 'beat'
            ? '正在按动作拆分'
            : currentEpisode
              ? `细拆第 ${currentEpisode.number} 集动作`
              : '细拆全部剧集动作'}
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => setEditing(newShotDraft())}
          disabled={controlsLocked}
        >
          <Plus size={16} /> 添加分镜
        </button>
        {!hasScriptEpisodeWorkflow && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setEditing(newShotDraft((latestEpisode?.number || 0) + 1, true))}
            disabled={controlsLocked}
          >
            <BookOpenText size={16} /> 添加分集
          </button>
        )}
        <label className="batch-resolution-control">
          <span>批量清晰度</span>
          <select
            value={batchResolution}
            onChange={(event) => setBatchResolution(event.target.value)}
            disabled={controlsLocked}
          >
            {VIDEO_RESOLUTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="batch-mode-control" role="group" aria-label="批量生成策略">
          <button
            type="button"
            className={batchMode === 'parallel' ? 'active' : ''}
            aria-pressed={batchMode === 'parallel'}
            title={`最多同时执行 ${concurrency} 路视频链路`}
            onClick={() => setBatchMode('parallel')}
            disabled={controlsLocked}
          >
            <Zap size={14} /> 分段并发
          </button>
          <button
            type="button"
            className={batchMode === 'continuity' ? 'active' : ''}
            aria-pressed={batchMode === 'continuity'}
            title="把全部镜头设为一条尾帧承接链，严格按顺序生成"
            onClick={() => setBatchMode('continuity')}
            disabled={controlsLocked}
          >
            <Link2 size={14} /> 全片串联
          </button>
        </div>
        <button
          className="button primary"
          onClick={() => void generateAll()}
          disabled={!rangeShots.length || controlsLocked}
        >
          {generatingAll ? <LoaderCircle size={16} className="spin" /> : <Video size={16} />}
          {generatingAll
            ? '正在加入队列'
            : currentEpisode
              ? `生成第 ${currentEpisode.number} 集视频`
              : batchMode === 'parallel'
                ? '安全并发生成全部剧集'
                : '按集串联生成'}
        </button>
        <span className="safe-parallel-help" tabIndex={0} aria-label="安全并发生成说明">
          <CircleHelp size={16} />
          <span role="tooltip">独立镜头链会同时生成；同一链内必须等上一镜真实尾帧返回后再生成下一镜。</span>
        </span>
        <button
          className="button secondary"
          onClick={() => void generateAll('independent')}
          disabled={!rangeShots.length || controlsLocked}
          title="忽略尾帧承接，把所有镜头作为独立任务同时提交"
        >
          <Zap size={16} /> 全部独立生成
        </button>
        <button
          className="button secondary"
          onClick={() => void downloadCompletedVideos()}
          disabled={!downloadableVideos.length || downloadingVideos}
          title={`下载当前选中的已完成视频版本，共 ${downloadableVideos.length} 条`}
        >
          {downloadingVideos ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
          {downloadingVideos
            ? '正在打包'
            : currentEpisode
              ? `下载第 ${currentEpisode.number} 集 · ${downloadableVideos.length} 条`
              : `批量下载 ${downloadableVideos.length} 条`}
        </button>
      </PageHeader>
      {!hasScriptEpisodeWorkflow && (
        <div className="episode-split-toolbar">
          <div>
            <span className="eyebrow">剧集结构</span>
            <strong>按目标时长自动分集</strong>
            <small>镜头保持完整，钩子留在本集末镜；强制分集标记优先生效</small>
          </div>
          <label>
            <span>每集时长</span>
            <span className="episode-duration-input">
              <input
                aria-label="分镜每集时长（秒）"
                type="number"
                min="30"
                max="300"
                step="1"
                value={episodeDuration}
                disabled={controlsLocked}
                onChange={(event) => setEpisodeDuration(Number(event.target.value) || 0)}
                onBlur={() => {
                  const next = Math.min(300, Math.max(30, Math.round(Number(episodeDuration) || 60)))
                  setEpisodeDuration(next)
                  if (next !== projectEpisodeDurationSeconds && onUpdateEpisodeDuration) {
                    void onUpdateEpisodeDuration(next).catch((error) => setOperationError(error.message))
                  }
                }}
              />
              <em>秒</em>
            </span>
            <span className="episode-duration-source">沿用剧本设置</span>
          </label>
          <button
            className="button secondary"
            disabled={!shots.length || controlsLocked}
            onClick={() => void autoSplitEpisodes()}
          >
            {splittingEpisodes ? <LoaderCircle size={16} className="spin" /> : <Scissors size={16} />}
            {splittingEpisodes ? '正在分集' : '自动分集'}
          </button>
        </div>
      )}
      <div className="storyboard-summary">
        <span>
          <Film size={16} />
          {currentEpisode ? `第 ${currentEpisode.number} 集` : `${episodes.length} 集`} · {rangeShots.length}{' '}
          个镜头
        </span>
        <div>
          <span>{rangeShots.length} 个镜头</span>
          <span>{totalDuration} 秒</span>
          <span>{continuityPointCount} 个镜内衔接点</span>
          <span>
            {batchPlan.immediateLaneCount} / {unlimitedConcurrency ? '演示不限' : concurrency} 路链路
          </span>
        </div>
      </div>
      <div className="storyboard-continuity-note">
        <Link2 size={16} />
        <div>
          <strong>连续性工作台</strong>
          <span>
            {batchMode === 'parallel'
              ? `只在独立场次之间建立 ${batchPlan.immediateLaneCount} 路并发；连续镜头链绝不拆分，链内等待真实尾帧。`
              : '全部镜头将设为一条承接链；上一镜头尾帧落盘后，下一镜头才会提交。'}
          </span>
        </div>
      </div>
      {operationError && (
        <p className="operation-error" role="alert">
          {operationError}
        </p>
      )}
      {operationNotice && (
        <p className="operation-notice" role="status">
          {operationNotice}
        </p>
      )}
      {batchLocked && (
        <div className="storyboard-batch-lock" role="status">
          <LockKeyhole size={17} />
          <div>
            <strong>当前生成批次已锁定</strong>
            <span>
              有 {activeShotCount}{' '}
              个分镜视频任务仍在排队、暂停或生成中。批次策略暂时锁定；未在执行的镜头仍可编辑，也可确认后强制独立生成。
            </span>
          </div>
        </div>
      )}
      {episodes.length > 1 && (
        <nav className="episode-navigator" aria-label="剧集导航">
          <div>
            <span>当前查看</span>
            <strong>
              {selectedEpisode === 'all'
                ? `全部 ${episodes.length} 集`
                : episodes[selectedEpisodeIndex]?.title || '选择剧集'}
            </strong>
          </div>
          <IconButton
            label="上一集"
            disabled={selectedEpisode === 'all' || selectedEpisodeIndex <= 0}
            onClick={() => setSelectedEpisode(episodeKey(episodes[selectedEpisodeIndex - 1]))}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <select
            value={selectedEpisode}
            aria-label="选择要查看的剧集"
            onChange={(event) => setSelectedEpisode(event.target.value)}
          >
            {episodes.map((episode) => (
              <option value={episodeKey(episode)} key={episodeKey(episode)}>
                第 {episode.number} 集 · {episode.title} · {episode.shots.length} 镜
              </option>
            ))}
            <option value="all">全部剧集</option>
          </select>
          <IconButton
            label="下一集"
            disabled={selectedEpisode === 'all' || selectedEpisodeIndex >= episodes.length - 1}
            onClick={() => setSelectedEpisode(episodeKey(episodes[selectedEpisodeIndex + 1]))}
          >
            <ChevronRight size={16} />
          </IconButton>
        </nav>
      )}
      <div className="episode-list">
        {visibleEpisodes.map((episode) => (
          <section className={`episode-group ${episode.kind}`} key={episode.number}>
            <header className="episode-header">
              <div>
                <span>第 {episode.number} 集</span>
                <strong>{episode.title}</strong>
                {episode.hasHook && <small>末镜为剧情钩子</small>}
              </div>
              <div>
                <span>{episode.shots.length} 个镜头</span>
                <span>{episode.duration} 秒</span>
              </div>
            </header>
            <div className="shot-list">
              {!episode.shots.length && (
                <div className="episode-empty-state">
                  <div>
                    <strong>本集还没有分镜</strong>
                    <span>从已保存的第 {episode.number} 集剧本按场次生成，不会覆盖其他集。</span>
                  </div>
                  <button
                    type="button"
                    className="button primary"
                    disabled={controlsLocked || !episode.scriptEpisodeId}
                    onClick={() => void splitFromScript('scene', episode)}
                  >
                    <Film size={16} /> 生成本集分镜
                  </button>
                </div>
              )}
              {episode.shots.map((shot, shotIndex) => {
                const previousShot = shotIndex > 0 ? episode.shots[shotIndex - 1] : null
                return (
                  <ShotRow
                    key={shot.id}
                    shot={shot}
                    minDuration={shotMinDuration}
                    previousShot={previousShot}
                    selected={selected === shot.id}
                    assets={assets}
                    assetIndex={assetIndex}
                    references={shotReferences.get(shot.id) || []}
                    tasks={tasks}
                    batchLocked={batchLocked}
                    resolution={
                      shotResolutions[shot.id] ||
                      videoResolutionForTask(taskFor(tasks, shot, 'video'), VIDEO_RESOLUTIONS) ||
                      batchResolution
                    }
                    onSelect={() => setSelected(shot.id)}
                    onResolutionChange={(value) =>
                      setShotResolutions((current) => ({ ...current, [shot.id]: value }))
                    }
                    onUpdate={onUpdate}
                    onEdit={() => setEditing(shot)}
                    onHistory={() => setHistoryShotId(shot.id)}
                    onDelete={() => void deleteShot(shot)}
                    deleting={deletingShotId === shot.id}
                    onGenerateVideo={onGenerateVideo}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <div className="sticky-actions">
        <span>视频 18 积分；直接使用项目资产与上一镜真实尾帧，不预生成静态分镜图。</span>
        <button className="button primary" onClick={onNext}>
          查看生成队列 <ArrowRight size={16} />
        </button>
      </div>
      {editing && (
        <ShotEditor
          shot={editing}
          shots={shots}
          minDuration={shotMinDuration}
          assets={assets}
          tasks={tasks}
          onUpload={onUpload}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing.id && isActive(taskFor(tasks, editing, 'video'))) {
              setOperationError('这个镜头正在生成，当前版本完成或取消后才能修改。')
              return
            }
            if (editing.id) await onUpdate(editing.id, input)
            else await onCreate(input)
            setEditing(null)
          }}
        />
      )}
      {historyShot && (
        <ShotHistoryModal
          shot={historyShot}
          tasks={tasks}
          onClose={() => setHistoryShotId(null)}
          onRestore={async (kind, taskId) => {
            const field = kind === 'image' ? 'selectedImageTaskId' : 'selectedVideoTaskId'
            await onUpdate(historyShot.id, { [field]: taskId })
          }}
          onOpenVersionEditor={(task) => {
            const snapshot = task.metadata?.sourceShotSnapshot
            const prompt =
              (snapshot && typeof snapshot === 'object' && typeof snapshot.prompt === 'string'
                ? snapshot.prompt
                : null) ||
              (typeof task.metadata?.sourcePromptSnapshot === 'string'
                ? task.metadata.sourcePromptSnapshot
                : historyShot.prompt)
            const negativePrompt =
              (snapshot && typeof snapshot === 'object' && typeof snapshot.negativePrompt === 'string'
                ? snapshot.negativePrompt
                : null) ||
              (typeof task.metadata?.userNegativePrompt === 'string'
                ? task.metadata.userNegativePrompt
                : historyShot.negativePrompt)
            setHistoryShotId(null)
            setEditing({ ...historyShot, prompt, negativePrompt })
          }}
        />
      )}
    </div>
  )
}

export { addStoryboardVideosToArchive, groupShotsByEpisode } from '../features/storyboard/storyboardState'
