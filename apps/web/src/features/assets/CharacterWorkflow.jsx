import { CheckCircle2, Download, Images, LoaderCircle, Lock, ScanFace, UserRound } from 'lucide-react'
import { useState } from 'react'

const STAGES = [
  ['face', '面部定稿', ScanFace],
  ['body', '全身定稿', UserRound],
  ['turnaround', '三视图', Images],
]

export function CharacterWorkflow({
  assetId,
  assetName,
  stage,
  attributes,
  references,
  tasks,
  onStageChange,
  onAttributesChange,
  onPersist,
  onGenerate,
}) {
  const [error, setError] = useState('')
  const relatedTasks = tasks.filter((task) => task.metadata?.assetId === assetId)
  const taskFor = (targetStage) => relatedTasks.find((task) => task.metadata?.generationStage === targetStage)
  const faceTask = taskFor('face')
  const bodyTask = taskFor('body')
  const turnaroundTask = taskFor('turnaround')
  const faceCandidate = completedOutput(faceTask) || references[0] || null
  const bodyCandidate = completedOutput(bodyTask)

  const persist = async (next) => {
    setError('')
    onAttributesChange(next)
    try {
      await onPersist(next)
      return true
    } catch (persistError) {
      setError(persistError.message)
      return false
    }
  }

  const approveFace = async () => {
    if (!faceCandidate) return
    const next = {
      ...attributes,
      faceStatus: 'approved',
      faceReference: toReference(faceCandidate, `${assetName}-面部基准`),
      bodyStatus: 'pending',
      bodyReference: null,
    }
    if (await persist(next)) onStageChange('body')
  }

  const approveBody = async () => {
    if (!bodyCandidate) return
    const next = {
      ...attributes,
      bodyStatus: 'approved',
      bodyReference: toReference(bodyCandidate, `${assetName}-全身基准`),
    }
    if (await persist(next)) onStageChange('turnaround')
  }

  return (
    <section className="character-workflow">
      <div className="character-stage-nav">
        {STAGES.map(([id, label, Icon], index) => {
          const unlocked =
            id === 'face' ||
            (id === 'body' && attributes.faceStatus === 'approved') ||
            (id === 'turnaround' && attributes.bodyStatus === 'approved')
          const completed =
            (id === 'face' && attributes.faceStatus === 'approved') ||
            (id === 'body' && attributes.bodyStatus === 'approved') ||
            (id === 'turnaround' && turnaroundTask?.status === 'completed')
          return (
            <button
              type="button"
              key={id}
              disabled={!unlocked}
              aria-current={stage === id ? 'step' : undefined}
              className={`${stage === id ? 'active' : ''} ${completed ? 'completed' : ''}`}
              onClick={() => onStageChange(id)}
            >
              <span>
                {completed ? <CheckCircle2 size={15} /> : unlocked ? <Icon size={15} /> : <Lock size={14} />}
              </span>
              <small>步骤 {index + 1}</small>
              <strong>{label}</strong>
            </button>
          )
        })}
      </div>

      {stage === 'face' && (
        <StagePanel
          eyebrow="身份锚点"
          title="先确定人物面部"
          description="大头照只处理脸型、五官、年龄、发型和画风。确认后全身与三视图都会固定使用它。"
          task={faceTask}
          reference={attributes.faceReference || faceCandidate}
          emptyText={
            assetId ? '生成一张大头照，或切换本地导入上传参考图。' : '先保存人物资产，再生成面部大头照。'
          }
        >
          <button
            className="button secondary"
            type="button"
            disabled={!assetId || isActive(faceTask)}
            onClick={() => onGenerate('face')}
          >
            {isActive(faceTask) ? <LoaderCircle size={15} className="spin" /> : <ScanFace size={15} />}
            {faceTask ? '重新生成大头照' : '生成面部大头照'}
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!assetId || !faceCandidate}
            onClick={() => void approveFace()}
          >
            <CheckCircle2 size={15} />
            设为面部基准
          </button>
        </StagePanel>
      )}

      {stage === 'body' && (
        <StagePanel
          eyebrow="身体设定"
          title="基于确认面部制作全身"
          description="全身生成会自动携带面部基准；腿部优化仅影响身体比例，不改变已确认的脸。"
          task={bodyTask}
          reference={bodyCandidate || attributes.bodyReference || attributes.faceReference}
          emptyText="选择体型和背景后生成全身候选。"
        >
          <label className={`asset-toggle compact ${attributes.legStretch ? 'active' : ''}`}>
            <input
              type="checkbox"
              checked={attributes.legStretch}
              onChange={(event) => onAttributesChange({ ...attributes, legStretch: event.target.checked })}
            />
            <span className="asset-toggle-check">{attributes.legStretch && <CheckCircle2 size={13} />}</span>
            <span>
              <strong>适度拉长腿部</strong>
              <small>保持身体结构和面部身份不变</small>
            </span>
          </label>
          <button
            className="button secondary"
            type="button"
            disabled={isActive(bodyTask)}
            onClick={() => onGenerate('body')}
          >
            {isActive(bodyTask) ? <LoaderCircle size={15} className="spin" /> : <UserRound size={15} />}
            {bodyTask ? '重新生成全身' : '生成全身候选'}
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!bodyCandidate}
            onClick={() => void approveBody()}
          >
            <CheckCircle2 size={15} />
            确认全身基准
          </button>
        </StagePanel>
      )}

      {stage === 'turnaround' && (
        <div className="turnaround-panel">
          <div className="turnaround-panel-head">
            <div>
              <span className="eyebrow">交付设定表</span>
              <h3>生成一张三视图设定表</h3>
              <p>系统保留正面、侧面、背面三张源图，默认合成一张 16:9 三栏图片。</p>
            </div>
            <div className="turnaround-layout" role="group" aria-label="三视图输出方式">
              <button
                type="button"
                aria-pressed={attributes.turnaroundLayout === 'sheet'}
                className={attributes.turnaroundLayout === 'sheet' ? 'active' : ''}
                onClick={() => onAttributesChange({ ...attributes, turnaroundLayout: 'sheet' })}
              >
                一张设定表
              </button>
              <button
                type="button"
                aria-pressed={attributes.turnaroundLayout === 'separate'}
                className={attributes.turnaroundLayout === 'separate' ? 'active' : ''}
                onClick={() => onAttributesChange({ ...attributes, turnaroundLayout: 'separate' })}
              >
                三张源图
              </button>
            </div>
          </div>
          <TurnaroundPreview task={turnaroundTask} />
          <div className="character-stage-actions">
            <button
              className="button secondary"
              type="button"
              disabled={isActive(turnaroundTask)}
              onClick={() => onGenerate('turnaround')}
            >
              {isActive(turnaroundTask) ? <LoaderCircle size={15} className="spin" /> : <Images size={15} />}
              {turnaroundTask ? '重新生成三视图' : '生成三视图'}
            </button>
            {turnaroundTask?.status === 'completed' && turnaroundTask.outputs.length >= 3 && (
              <button
                className="button primary"
                type="button"
                onClick={() =>
                  void downloadSheet(turnaroundTask.outputs, assetName).catch((downloadError) =>
                    setError(downloadError.message),
                  )
                }
              >
                <Download size={15} />
                下载一张设定表
              </button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="character-workflow-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function StagePanel({ eyebrow, title, description, task, reference, emptyText, children }) {
  return (
    <div className="character-stage-panel">
      <div className="character-stage-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="character-stage-preview">
        {reference?.url ? (
          <img src={reference.url} alt={title} />
        ) : (
          <div>
            <ScanFace size={25} />
            <span>{emptyText}</span>
          </div>
        )}
        {task && <TaskState task={task} />}
      </div>
      <div className="character-stage-actions">{children}</div>
    </div>
  )
}

function TaskState({ task }) {
  const labels = {
    queued: '排队中',
    running: `生成中 ${task.progress}%`,
    completed: '候选已生成',
    failed: '生成失败',
  }
  return (
    <span className={`character-task-state ${task.status}`} role="status" aria-live="polite">
      {labels[task.status] || task.status}
    </span>
  )
}

function TurnaroundPreview({ task }) {
  if (!task || task.status !== 'completed') {
    return (
      <div className="turnaround-empty">
        <Images size={28} />
        <span>{isActive(task) ? `正在生成源图 ${task.progress}%` : '完成面部和全身定稿后生成'}</span>
      </div>
    )
  }
  const outputs = task.outputs.slice(0, 3)
  return (
    <div className="turnaround-sheet-preview">
      {outputs.map((output) => (
        <div key={output.id}>
          <img src={output.url} alt={viewLabel(output.view)} />
          <span>{viewLabel(output.view)}</span>
        </div>
      ))}
    </div>
  )
}

function completedOutput(task) {
  return task?.status === 'completed' ? task.outputs[0] || null : null
}

function isActive(task) {
  return task?.status === 'queued' || task?.status === 'running'
}

function toReference(candidate, name) {
  return { id: candidate.id, url: candidate.url, name }
}

function viewLabel(view) {
  return { front: '正面', side: '侧面', back: '背面' }[view] || '设定图'
}

async function downloadSheet(outputs, name) {
  const selected = outputs.slice(0, 3)
  if (selected.length < 3) throw new Error('三张源图尚未全部生成')
  const images = await Promise.all(selected.map((output) => loadImage(output.url)))
  const canvas = document.createElement('canvas')
  canvas.width = 2400
  canvas.height = 1350
  const context = canvas.getContext('2d')
  context.fillStyle = '#f4f5f1'
  context.fillRect(0, 0, canvas.width, canvas.height)
  images.forEach((image, index) => drawContained(context, image, index * 800 + 40, 70, 720, 1160))
  context.fillStyle = '#20241f'
  context.font = '600 34px sans-serif'
  context.textAlign = 'center'
  selected.forEach((output, index) => context.fillText(viewLabel(output.view), index * 800 + 400, 1285))
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('设定表合成失败')
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${name || '人物'}-三视图设定表.png`
  anchor.click()
  URL.revokeObjectURL(url)
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('三视图源图读取失败'))
    image.src = url
  })
}

function drawContained(context, image, x, y, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}
