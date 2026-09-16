import { useRef, useState } from 'react'
import { ArrowRight, History, LoaderCircle, Pencil, RotateCcw, Video } from 'lucide-react'
import { LibraryDialog } from '../assetLibrary/LibraryDialog'
import { shotVersionState, taskOutputUrl } from './storyboardState'
import '../assetLibrary/assetLibrary.css'
import './shotHistory.css'

export function ShotHistoryModal({ shot, tasks, locked, onClose, onRestore, onOpenVersionEditor }) {
  // Keep the previewed target stable while the task list refreshes in the background.
  const [{ current, previous, latest }] = useState(() => shotVersionState(tasks, shot, 'video'))
  const [restoring, setRestoring] = useState('')
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const busy = Boolean(restoring)
  const canRollback = Boolean(previous && taskOutputUrl(previous.task, 'video'))
  const canReturnToLatest =
    latest && current?.task.id !== latest.task.id && taskOutputUrl(latest.task, 'video')
  const restore = async (version, action) => {
    if (submitting.current || locked || !version) return
    submitting.current = true
    setRestoring(action)
    setError('')
    try {
      await onRestore(version.task.id, {
        currentTaskId: current?.task.id,
        versionNumber: version.number,
        action,
      })
      onClose()
    } catch (failure) {
      setError(failure.message || '版本切换失败，请刷新确认当前版本后重试。')
    } finally {
      submitting.current = false
      setRestoring('')
    }
  }
  return (
    <LibraryDialog
      title="回退到上一版本"
      className="shot-rollback-dialog"
      onClose={() => {
        if (!submitting.current) onClose()
      }}
    >
      <div className="shot-rollback-body">
        <p className="shot-rollback-intro">
          <strong>{shot.title}</strong> · 将本镜头的视频换回上一版，所有已生成版本都会保留。
        </p>
        <div className="shot-rollback-comparison">
          <VersionPreview
            version={current}
            title="当前使用"
            busy={busy || locked}
            onEdit={onOpenVersionEditor}
          />
          <ArrowRight className="shot-rollback-arrow" size={22} aria-hidden="true" />
          <VersionPreview
            version={previous}
            title="将恢复的上一版"
            emptyDescription={
              current
                ? '当前已是最早的已完成版本，没有更早的视频可回退。'
                : '生成至少两个视频版本后，即可回退到上一版。'
            }
            target
            busy={busy || locked}
            onEdit={onOpenVersionEditor}
          />
        </div>
        <div className="shot-rollback-note">
          <span>
            <RotateCcw size={16} /> 回退免费，不会重新生成视频
          </span>
          <p>本镜头预览立即切换。已合成的完整成片需要重新合成；已生成的后续镜头保持原样。</p>
        </div>
        {locked && (
          <p className="shot-rollback-warning" role="status">
            当前批次仍在生成，完成后才能切换版本。
          </p>
        )}
        {error && (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}
        <footer className="shot-rollback-actions">
          {canReturnToLatest && (
            <button
              type="button"
              className="button secondary"
              disabled={busy || locked}
              onClick={() => void restore(latest, 'latest')}
            >
              {restoring === 'latest' ? <LoaderCircle size={16} className="spin" /> : <History size={16} />}{' '}
              切回最新版本 V{latest.number}
            </button>
          )}
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || locked || !canRollback}
            onClick={() => void restore(previous, 'rollback')}
          >
            {restoring === 'rollback' ? <LoaderCircle size={17} className="spin" /> : <RotateCcw size={17} />}
            {restoring === 'rollback' ? '正在回退…' : '确认回退到上一版本'}
          </button>
        </footer>
      </div>
    </LibraryDialog>
  )
}

function VersionPreview({ version, title, target = false, busy, onEdit, emptyDescription }) {
  const task = version?.task
  const url = taskOutputUrl(task, 'video')
  return (
    <section className={`shot-rollback-version ${target ? 'target' : ''}`} aria-label={title}>
      <header>
        <span>{title}</span>
        {version && <strong>V{version.number}</strong>}
      </header>
      {task ? (
        <>
          {url ? (
            <video
              src={url}
              controls
              playsInline
              preload="none"
              aria-label={`${title} V${version.number} 视频预览`}
            />
          ) : (
            <div className="shot-rollback-empty">
              <Video size={28} />
              <strong>这版暂无可用视频</strong>
            </div>
          )}
          <p className="shot-rollback-time">生成于 {formatVersionTime(task.createdAt || task.updatedAt)}</p>
          {onEdit && (
            <button type="button" className="button secondary" disabled={busy} onClick={() => onEdit(task)}>
              <Pencil size={15} /> 用此版提示词编辑
            </button>
          )}
        </>
      ) : (
        <div className="shot-rollback-empty">
          <History size={28} />
          <strong>{target ? '暂无上一版本' : '暂无已完成的视频'}</strong>
          <p>{emptyDescription || '视频生成完成后会保留在这里。'}</p>
        </div>
      )}
    </section>
  )
}

function formatVersionTime(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
