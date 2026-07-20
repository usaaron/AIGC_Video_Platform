import { CheckCircle2, Download, Images, LoaderCircle, Lock, ScanFace, UserRound } from 'lucide-react'
import { useState } from 'react'

import { CharacterStagePanel } from './CharacterStagePanel'
import { TurnaroundPreview } from './TurnaroundPreview'
import {
  completedOutput,
  downloadTurnaroundSheet,
  isActive,
  orderedTurnaroundOutputs,
  toReference,
} from './characterWorkflowUtils'
import './characterWorkflow.css'

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
  const [submittingStage, setSubmittingStage] = useState(null)
  const relatedTasks = assetId ? tasks.filter((task) => task.metadata?.assetId === assetId) : []
  const taskFor = (targetStage) => relatedTasks.find((task) => task.metadata?.generationStage === targetStage)
  const faceTask = taskFor('face')
  const bodyTask = taskFor('body')
  const turnaroundTask = taskFor('turnaround')
  const faceCandidate = completedOutput(faceTask) || references[0] || null
  const bodyCandidate = completedOutput(bodyTask)
  const turnaroundOutputs = orderedTurnaroundOutputs(
    turnaroundTask?.status === 'completed' && turnaroundTask.outputs.length
      ? turnaroundTask.outputs
      : attributes.turnaroundReferences,
  )

  const generate = async (targetStage, view = null) => {
    setError('')
    setSubmittingStage(view || targetStage)
    try {
      await onGenerate(targetStage, view)
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setSubmittingStage(null)
    }
  }

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
      turnaround: false,
      turnaroundReferences: [],
    }
    if (await persist(next)) onStageChange('body')
  }

  const approveBody = async () => {
    if (!bodyCandidate) return
    const next = {
      ...attributes,
      bodyStatus: 'approved',
      bodyReference: toReference(bodyCandidate, `${assetName}-全身基准`),
      turnaround: false,
      turnaroundReferences: [],
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
            (id === 'turnaround' && turnaroundOutputs.length >= 3)
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
        <CharacterStagePanel
          eyebrow="身份锚点"
          title="先确定人物面部"
          description="大头照只处理脸型、五官、年龄、发型和画风。确认后全身与三视图都会固定使用它。"
          task={faceTask}
          reference={attributes.faceReference || faceCandidate}
          emptyText={
            assetId
              ? '生成一张大头照，或切换本地导入上传参考图。'
              : '填写人物名称后可直接生成，系统会自动保存人物草稿。'
          }
        >
          <button
            className="button secondary"
            type="button"
            disabled={submittingStage !== null || isActive(faceTask)}
            onClick={() => void generate('face')}
          >
            {submittingStage === 'face' || isActive(faceTask) ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <ScanFace size={15} />
            )}
            {submittingStage === 'face' ? '正在创建并生成' : faceTask ? '重新生成大头照' : '生成面部大头照'}
          </button>
          <button
            className="button primary"
            type="button"
            disabled={submittingStage !== null || !faceCandidate}
            onClick={() => void approveFace()}
          >
            <CheckCircle2 size={15} />
            设为面部基准
          </button>
        </CharacterStagePanel>
      )}

      {stage === 'body' && (
        <CharacterStagePanel
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
            disabled={submittingStage !== null || isActive(bodyTask)}
            onClick={() => void generate('body')}
          >
            {submittingStage === 'body' || isActive(bodyTask) ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <UserRound size={15} />
            )}
            {bodyTask ? '重新生成全身' : '生成全身候选'}
          </button>
          <button
            className="button primary"
            type="button"
            disabled={submittingStage !== null || !bodyCandidate}
            onClick={() => void approveBody()}
          >
            <CheckCircle2 size={15} />
            确认全身基准
          </button>
        </CharacterStagePanel>
      )}

      {stage === 'turnaround' && (
        <div className="turnaround-panel">
          <div className="turnaround-panel-head">
            <div>
              <span className="eyebrow">交付设定表</span>
              <h3>生成三张三视图源图</h3>
              <p>系统保留正面、侧面、背面三张源图，前端按选择组合预览和下载设定表。</p>
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
          <TurnaroundPreview
            task={turnaroundTask}
            outputs={turnaroundOutputs}
            disabled={submittingStage !== null || isActive(turnaroundTask)}
            onRegenerateView={(view) => void generate('turnaround', view)}
          />
          <div className="character-stage-actions">
            <button
              className="button secondary"
              type="button"
              disabled={submittingStage !== null || isActive(turnaroundTask)}
              onClick={() => void generate('turnaround')}
            >
              {submittingStage === 'turnaround' || isActive(turnaroundTask) ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Images size={15} />
              )}
              {turnaroundTask ? '重新生成三视图' : '生成三视图'}
            </button>
            {turnaroundOutputs.length >= 3 && (
              <button
                className="button primary"
                type="button"
                onClick={() =>
                  void downloadTurnaroundSheet(turnaroundOutputs, assetName).catch((downloadError) =>
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
