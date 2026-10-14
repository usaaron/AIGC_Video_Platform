import { useRef, useState } from 'react'
import { needsVideoReview, physicalAuditState, videoReviewState } from '@seqora/contracts'
import { SCENE_EXECUTION_REVIEW, sceneExecutionGaps } from '@seqora/prompting'
import './videoReview.css'

const PHYSICS_STATUS_LABELS = {
  passed: '物理验收通过',
  failed: '物理验收失败',
  'needs-evidence': '缺少逐帧证据',
  'pending-evidence': '待逐帧证据',
  pending: '待逐帧证据',
  needs_evidence: '缺少逐帧证据',
}

const PHYSICS_VIOLATION_LABELS = {
  FRAME_EVIDENCE_MISSING: '逐帧证据缺失',
  CAMERA_CUT_FORBIDDEN: '不允许镜头切换',
  ANCHOR_DRIFT: '锚点漂移',
  DIMENSION_DRIFT: '结构尺寸漂移',
  MEMBER_COUNT_DRIFT: '杆件数量变化',
  OBJECT_FOLLOWS_CROWD: '刚体跟随人群移动',
  FIXED_OBJECT_MOVED: '固定物体发生位移',
  FIXED_OBJECT_DEFORMED: '固定物体发生变形',
  SLIDE_AXIS_BREACHED: '滑动方向越界',
  DISPLACEMENT_LIMIT_BREACHED: '整体位移超出合同',
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function physicsStatusLabel(status) {
  return PHYSICS_STATUS_LABELS[status] || (status ? `状态：${status}` : '待逐帧证据')
}

function physicsViolationLabel(violation) {
  const code = String(violation?.code || '')
  const label = PHYSICS_VIOLATION_LABELS[code] || code || '物理验收问题'
  return violation?.frame === undefined ? label : `${label} · 第 ${Number(violation.frame) + 1} 帧`
}

function physicsContractObjects(task) {
  const contract = asRecord(task?.metadata?.rigidPhysicsContract)
  return Array.isArray(contract?.objects) ? contract.objects : []
}

function physicsEvidenceRows(task) {
  const audit = asRecord(task?.metadata?.rigidPhysicsAudit)
  const evidence = audit?.frameEvidence || audit?.evidenceCoverage || audit?.evidence
  if (Array.isArray(evidence)) return evidence
  if (Array.isArray(asRecord(evidence)?.frames)) return asRecord(evidence).frames
  if (Array.isArray(asRecord(audit)?.observations)) return asRecord(audit).observations
  return []
}

function evidenceCoverage(task, object) {
  const audit = asRecord(task?.metadata?.rigidPhysicsAudit)
  const rows = physicsEvidenceRows(task)
  const objectId = String(object?.id || '')
  const anchors = Array.isArray(object?.anchors) ? object.anchors : []
  const objectRows = rows.filter((row) => String(row?.objectId || '') === objectId)
  const coverage = asRecord(audit?.evidenceCoverage)
  const summary = Array.isArray(audit?.evidence?.objects)
    ? audit.evidence.objects.find((row) => String(row?.objectId || '') === objectId)
    : null
  const explicit = asRecord(coverage?.[objectId]) || asRecord(coverage?.objects)?.[objectId] || coverage
  const coveredFrames = Number(
    explicit?.coveredFrames ??
      explicit?.framesCovered ??
      summary?.trackedFrames ??
      explicit?.frames ??
      objectRows.length,
  )
  const missingFrames = Array.isArray(summary?.missingFrames) ? summary.missingFrames.length : 0
  const totalFrames = Number(
    explicit?.totalFrames ??
      explicit?.framesTotal ??
      (summary ? summary.trackedFrames + missingFrames : (audit?.checkedFrames ?? objectRows.length)),
  )
  const trackedAnchors = anchors.filter((anchor) =>
    objectRows.some((row) => asRecord(row?.anchorPoints)?.[anchor.id]),
  )
  return {
    coveredFrames: Number.isFinite(coveredFrames) ? coveredFrames : 0,
    totalFrames: Number.isFinite(totalFrames) ? totalFrames : 0,
    trackedAnchors,
    totalAnchors: anchors.length,
  }
}

function anchorLabel(anchor) {
  return anchor?.role === 'base' ? '底脚' : '连接点'
}

export function RigidPhysicsEvidence({ task }) {
  const audit = asRecord(task?.metadata?.rigidPhysicsAudit)
  if (!audit && !physicsContractObjects(task).length) return null
  const objects = physicsContractObjects(task)
  const rows = physicsEvidenceRows(task)
  return (
    <div className="rigid-physics-review" aria-label="刚性物理验收">
      <div className={`rigid-physics-status ${audit?.status || 'pending-evidence'}`}>
        <strong>{physicsStatusLabel(audit?.status)}</strong>
        <span>
          {Number(audit?.checkedFrames) > 0 ? `已检查 ${audit.checkedFrames} 帧` : '尚未完成逐帧检查'}
        </span>
      </div>
      {audit?.violations?.length > 0 ? (
        <ul className="rigid-physics-violations" aria-label="物理验收违规">
          {audit.violations.map((violation, index) => (
            <li key={`${violation.code || 'violation'}-${violation.frame ?? 'all'}-${index}`}>
              <strong>{physicsViolationLabel(violation)}</strong>
              {violation.detail && <span>{violation.detail}</span>}
            </li>
          ))}
        </ul>
      ) : audit?.status === 'passed' ? (
        <p className="rigid-physics-ok">未发现物理合同违规。</p>
      ) : null}
      {(objects.length > 0 || audit) && (
        <details className="rigid-physics-evidence" open>
          <summary>底脚与连接点逐帧证据覆盖</summary>
          <p>
            {rows.length
              ? `已接收 ${rows.length} 条逐帧记录。`
              : '当前没有可用的逐帧锚点记录，不能自动通过。'}
          </p>
          {objects.length > 0 ? (
            <ul>
              {objects.map((object) => {
                const coverage = evidenceCoverage(task, object)
                const anchorList = Array.isArray(object.anchors) ? object.anchors : []
                const anchorText = anchorList.length
                  ? anchorList.map((anchor) => `${anchorLabel(anchor)} ${anchor.id}`).join('、')
                  : '未声明锚点'
                return (
                  <li key={object.id}>
                    <strong>{object.label || object.id}</strong>
                    <span>
                      {coverage.coveredFrames}/{coverage.totalFrames} 帧 · {coverage.trackedAnchors.length}/
                      {coverage.totalAnchors} 个锚点（{anchorText}）
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p>当前物理合同未提供可核对的底脚或连接点定义。</p>
          )}
          {rows.length > 0 && (
            <ul className="rigid-physics-frame-list" aria-label="逐帧锚点证据">
              {rows.slice(0, 24).map((row, index) => {
                const object = objects.find((item) => String(item.id) === String(row?.objectId))
                const anchors = (Array.isArray(object?.anchors) ? object.anchors : []).filter(
                  (anchor) => asRecord(row?.anchorPoints)?.[anchor.id],
                )
                return (
                  <li key={`${row?.objectId || 'object'}-${row?.frame ?? index}-${index}`}>
                    第 {Number(row?.frame ?? index) + 1} 帧 · {object?.label || row?.objectId || '刚性物体'} ·{' '}
                    {anchors.length ? `已覆盖${anchors.map(anchorLabel).join('、')}` : '未覆盖底脚/连接点'}
                  </li>
                )
              })}
              {rows.length > 24 && <li>其余 {rows.length - 24} 条逐帧记录已折叠。</li>}
            </ul>
          )}
        </details>
      )}
    </div>
  )
}

export function VideoReviewPanel({ task, onReview }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submitLock = useRef(false)
  if (!needsVideoReview(task) || task.status !== 'completed') return null
  const state = videoReviewState(task)
  const physicsState = physicalAuditState(task)
  const physicsBlocked = !['none', 'passed'].includes(physicsState)
  const review = task.metadata?.contentReview
  const gaps = sceneExecutionGaps(task.metadata?.sourcePromptSnapshot || '')
  const submit = async (decision) => {
    if (submitLock.current) return
    submitLock.current = true
    setBusy(true)
    setError('')
    try {
      await onReview(task, decision, note)
    } catch (error) {
      setError(error.message || '验收保存失败，请重试')
    } finally {
      submitLock.current = false
      setBusy(false)
    }
  }
  return (
    <section
      className="video-content-review"
      aria-label="当前视频版本内容验收"
      onClick={(event) => event.stopPropagation()}
    >
      <strong>
        {state === 'approved'
          ? '内容验收通过'
          : state === 'rejected'
            ? '内容有问题 · 暂停承接'
            : '已生成 · 待内容验收'}
      </strong>
      <p>
        观看此版本，核对人物、持物、动作、屏幕及镜尾。验收通过后，已排队的衔接镜头可自动继续；撤回不能停止已提交的视频。
      </p>
      <RigidPhysicsEvidence task={task} />
      {physicsBlocked && (
        <p className="rigid-physics-blocking">
          物理验收{physicsStatusLabel(physicsState)}，完成底脚与连接点逐帧核对后才能通过内容验收。
        </p>
      )}
      <details className="scene-execution-review">
        <summary>场景合理性核对{gaps.length ? ` · ${gaps.length} 项设定待复核` : ''}</summary>
        <ul>
          {SCENE_EXECUTION_REVIEW.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {gaps.map((gap) => (
          <p key={gap.code}>{gap.message}</p>
        ))}
        <p>以上需对照实际画面确认；未提示缺项也不表示画面自动通过。</p>
      </details>
      {review?.note && <p>验收记录：{review.note}</p>}
      {onReview && (
        <>
          <input
            aria-label="内容验收备注"
            placeholder="问题或验收备注（标记问题时必填）"
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={busy}
          />
          <div>
            <button
              type="button"
              disabled={busy || state === 'approved' || physicsBlocked}
              onClick={() => void submit('approved')}
            >
              已观看，验收通过
            </button>
            <button type="button" disabled={busy || !note.trim()} onClick={() => void submit('rejected')}>
              标记画面问题
            </button>
            {state !== 'pending' && (
              <button type="button" disabled={busy} onClick={() => void submit('pending')}>
                撤回验收
              </button>
            )}
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
