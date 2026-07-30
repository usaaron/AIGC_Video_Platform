import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  Images,
  Link2,
  LoaderCircle,
  Lock,
  LogOut,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ImagePreviewModal } from '../../components/ImagePreviewModal'
import { confirmCharacterFace } from './assetDraft'

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
  onGenerateAndClose,
  faceCreationMode = 'text',
  settings,
  trustedConfiguration,
  onListTrustedPortraits,
  onRegisterVirtualPortrait,
  onBindTrustedPortrait,
  onRefreshTrustedPortrait,
  onEnsureAsset,
}) {
  const [error, setError] = useState('')
  const [submittingStage, setSubmittingStage] = useState(null)
  const [closingStage, setClosingStage] = useState(null)
  const [preview, setPreview] = useState(null)
  const relatedTasks = assetId ? tasks.filter((task) => task.metadata?.assetId === assetId) : []
  const taskFor = (targetStage) => latestStageTask(relatedTasks, targetStage)
  const faceTask = taskFor('face')
  const bodyTask = taskFor('body')
  const turnaroundTask = taskFor('turnaround')
  const generatedFaceCandidate = completedOutput(faceTask)
  const faceCandidate = faceCreationMode === 'direct' ? references[0] || null : generatedFaceCandidate
  const facePreview = faceCandidate || attributes.faceReference || references[0] || null
  const bodyCandidate = completedOutput(bodyTask)

  const generate = async (targetStage, closeAfterQueue = false) => {
    setError('')
    setSubmittingStage(targetStage)
    setClosingStage(closeAfterQueue ? targetStage : null)
    try {
      await (closeAfterQueue ? onGenerateAndClose(targetStage) : onGenerate(targetStage))
    } catch (generationError) {
      setError(generationError.message)
    } finally {
      setSubmittingStage(null)
      setClosingStage(null)
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
    const next = confirmCharacterFace(attributes, faceCandidate, assetName)
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

  const backgroundGenerateButton = (targetStage) => (
    <button
      className="button background-generation-button"
      type="button"
      disabled={submittingStage !== null || isActive(taskFor(targetStage))}
      onClick={() => void generate(targetStage, true)}
    >
      {closingStage === targetStage ? <LoaderCircle size={15} className="spin" /> : <LogOut size={15} />}
      {closingStage === targetStage ? '正在加入队列' : '后台生成并退出'}
    </button>
  )

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
      {settings}

      {attributes.subjectType === 'human' && (
        <TrustedPortraitPanel
          assetId={assetId}
          attributes={attributes}
          configuration={trustedConfiguration}
          onAttributesChange={onAttributesChange}
          onListTrustedPortraits={onListTrustedPortraits}
          onRegisterVirtualPortrait={onRegisterVirtualPortrait}
          onBindTrustedPortrait={onBindTrustedPortrait}
          onRefreshTrustedPortrait={onRefreshTrustedPortrait}
          onEnsureAsset={onEnsureAsset}
          onPreview={(reference) =>
            setPreview({
              url: reference.url,
              alt: reference.name || '可信人像预览',
              fileName: reference.name || '可信人像预览',
            })
          }
        />
      )}

      {stage === 'face' && (
        <StagePanel
          eyebrow="身份锚点"
          title="先确定人物面部"
          description={
            faceCreationMode === 'direct'
              ? '上传图会直接成为身份锚点；确认后全身与三视图都会固定使用它。'
              : '大头照只处理脸型、五官、年龄、发型和画风。确认后全身与三视图都会固定使用它。'
          }
          task={faceTask}
          reference={facePreview}
          onPreview={(reference) =>
            setPreview({
              url: reference.url,
              alt: `${assetName || '人物'}面部视图`,
              fileName: `${assetName || '人物'}-面部视图`,
            })
          }
          emptyText={
            faceCreationMode === 'direct'
              ? '上传一张清晰的正面大头照后设为面部基准。'
              : faceCreationMode === 'reference'
                ? '上传参考图后生成新的面部候选。'
                : assetId
                  ? '生成一张面部大头照。'
                  : '填写人物名称后可直接生成，系统会自动保存人物草稿。'
          }
        >
          {faceCreationMode !== 'direct' && (
            <>
              <button
                className="button secondary"
                type="button"
                disabled={submittingStage !== null || isActive(faceTask)}
                onClick={() => void generate('face')}
              >
                {(submittingStage === 'face' && closingStage !== 'face') || isActive(faceTask) ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <ScanFace size={15} />
                )}
                {submittingStage === 'face' && closingStage !== 'face'
                  ? '正在创建并生成'
                  : faceTask
                    ? '重新生成大头照'
                    : '生成面部大头照'}
              </button>
              {backgroundGenerateButton('face')}
            </>
          )}
          <button
            className="button primary"
            type="button"
            disabled={submittingStage !== null || !faceCandidate}
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
          previewMode="contain"
          onPreview={(reference) =>
            setPreview({
              url: reference.url,
              alt: `${assetName || '人物'}全身视图`,
              fileName: `${assetName || '人物'}-全身视图`,
            })
          }
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
            {(submittingStage === 'body' && closingStage !== 'body') || isActive(bodyTask) ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <UserRound size={15} />
            )}
            {bodyTask ? '重新生成全身' : '生成全身候选'}
          </button>
          {backgroundGenerateButton('body')}
          <button
            className="button primary"
            type="button"
            disabled={submittingStage !== null || !bodyCandidate}
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
          <TurnaroundPreview
            task={turnaroundTask}
            onPreview={(output) =>
              setPreview({
                url: output.url,
                alt: `${assetName || '人物'}${viewLabel(output.view)}视图`,
                fileName: `${assetName || '人物'}-${viewLabel(output.view)}视图`,
              })
            }
          />
          <div className="character-stage-actions">
            <button
              className="button secondary"
              type="button"
              disabled={submittingStage !== null || isActive(turnaroundTask)}
              onClick={() => void generate('turnaround')}
            >
              {(submittingStage === 'turnaround' && closingStage !== 'turnaround') ||
              isActive(turnaroundTask) ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Images size={15} />
              )}
              {turnaroundTask ? '重新生成三视图' : '生成三视图'}
            </button>
            {backgroundGenerateButton('turnaround')}
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
      {preview && <ImagePreviewModal image={preview} onClose={() => setPreview(null)} />}
    </section>
  )
}

function TrustedPortraitPanel({
  assetId,
  attributes,
  configuration,
  onAttributesChange,
  onListTrustedPortraits,
  onRegisterVirtualPortrait,
  onBindTrustedPortrait,
  onRefreshTrustedPortrait,
  onEnsureAsset,
  onPreview,
}) {
  const [providerAssetId, setProviderAssetId] = useState('')
  const [libraryGroupType, setLibraryGroupType] = useState('AIGC')
  const [libraryPortraits, setLibraryPortraits] = useState([])
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [busyAction, setBusyAction] = useState(null)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const refreshTrustedPortraitRef = useRef(onRefreshTrustedPortrait)
  const attributesChangeRef = useRef(onAttributesChange)
  const portrait = attributes.trustedPortrait
  const status = portrait?.status || 'unlinked'
  const statusLabels = {
    unlinked: '未绑定',
    processing: '上游处理中',
    active: '可用于视频',
    failed: '审核失败',
  }
  const activeLibraryPortraits = libraryPortraits.filter((item) => item.status === 'active')
  const registerBlocker = virtualPortraitRegistrationBlocker({
    assetId,
    canEnsureAsset: Boolean(onEnsureAsset),
    configuration,
    faceStatus: attributes.faceStatus,
    portrait,
    busyAction,
  })
  const registrationHint = registrationAvailabilityHint(registerBlocker)
  const registerButtonTitle = registerBlocker
    ? `当前不能创建 AI 人像资源：${registerBlocker}`
    : '提交已确认的面部基准到弦序素材库'
  const boundPreviewUrl = portraitPreviewUrl(portrait)

  useEffect(() => {
    if (portrait?.assetId) setProviderAssetId(portrait.assetId)
  }, [portrait?.assetId])

  useEffect(() => {
    refreshTrustedPortraitRef.current = onRefreshTrustedPortrait
    attributesChangeRef.current = onAttributesChange
  }, [onAttributesChange, onRefreshTrustedPortrait])

  useEffect(() => {
    if (!assetId || portrait?.status !== 'processing' || !refreshTrustedPortraitRef.current) return undefined
    let cancelled = false
    let timer

    const poll = async () => {
      try {
        const updated = await refreshTrustedPortraitRef.current(assetId)
        if (cancelled) return
        setPollError('')
        if (updated?.attributes) attributesChangeRef.current(updated.attributes)
        if (updated?.attributes?.trustedPortrait?.status === 'processing') {
          timer = window.setTimeout(poll, 4_000)
        }
      } catch (pollingError) {
        if (cancelled) return
        setPollError(pollingError instanceof Error ? pollingError.message : '自动同步上游状态失败')
        timer = window.setTimeout(poll, 8_000)
      }
    }

    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [assetId, portrait?.status])

  const run = async (action, callback) => {
    setBusyAction(action)
    setError('')
    setActionNotice(action === 'register' ? '正在提交面部基准到弦序素材库，请等待上游返回 Asset ID。' : '')
    if (action === 'register' || action === 'refresh') setPollError('')
    try {
      const updated = await callback()
      if (updated?.attributes) onAttributesChange(updated.attributes)
      if (action === 'register') {
        setActionNotice('创建申请已提交，系统会自动同步弦序状态；通过后即可用于 Seedance 视频。')
      } else if (action === 'refresh') {
        setActionNotice('已同步弦序人像状态。')
      } else if (action === 'bind') {
        setActionNotice('已校验并绑定可信人像。')
      } else if (action === 'list') {
        setActionNotice('素材库白名单已同步。')
      }
    } catch (actionError) {
      setActionNotice('')
      setError(actionError instanceof Error ? actionError.message : '可信人像操作失败')
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <section className={`trusted-portrait-panel status-${status}`}>
      <div className="trusted-portrait-head">
        <span className="trusted-portrait-icon">
          <ShieldCheck size={18} />
        </span>
        <div>
          <span className="eyebrow">Seedance 人脸资源</span>
          <h3>可信人像</h3>
        </div>
        <span className="trusted-portrait-status">{statusLabels[status]}</span>
      </div>

      {portrait && (
        <div className="trusted-portrait-binding">
          {boundPreviewUrl ? (
            <button
              className="trusted-portrait-binding-preview"
              type="button"
              aria-label="放大查看当前可信人像"
              onClick={() => onPreview?.({ url: boundPreviewUrl, name: portrait.name || portrait.assetId })}
            >
              <img src={boundPreviewUrl} alt="" />
            </button>
          ) : (
            <span className="trusted-portrait-binding-placeholder">
              <Images size={16} />
            </span>
          )}
          <span>{portrait.groupType === 'LivenessFace' ? '已授权真人' : 'AI 虚拟人'}</span>
          <code>{portrait.assetId}</code>
          <small>最近校验 {new Date(portrait.checkedAt).toLocaleString('zh-CN')}</small>
        </div>
      )}

      <div className="trusted-portrait-actions">
        <button
          className="button secondary"
          type="button"
          disabled={busyAction !== null}
          data-blocked={registerBlocker ? 'true' : undefined}
          title={registerButtonTitle}
          onClick={() => {
            if (registerBlocker) {
              setError('')
              setActionNotice(`当前不能创建 AI 人像资源：${registerBlocker}`)
              return
            }
            void run('register', async () => {
              const persisted = assetId ? { id: assetId } : await onEnsureAsset?.()
              if (!persisted?.id) throw new Error('请先保存人物资产，再创建 AI 人像资源')
              return onRegisterVirtualPortrait(persisted.id)
            })
          }}
        >
          {busyAction === 'register' ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <CloudUpload size={15} />
          )}
          {portrait?.groupType === 'AIGC' ? '重新提交 AI 人像' : '创建 AI 人像资源'}
        </button>

        {portrait && (
          <button
            className="button secondary"
            type="button"
            disabled={busyAction !== null}
            onClick={() => void run('refresh', () => onRefreshTrustedPortrait(assetId))}
          >
            {busyAction === 'refresh' ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            刷新状态
          </button>
        )}
      </div>
      {registrationHint && (
        <p className="trusted-portrait-registration-hint" role="status">
          {registrationHint}
        </p>
      )}
      {actionNotice && (
        <p className="trusted-portrait-action-notice" role="status" aria-live="polite">
          {actionNotice}
        </p>
      )}

      <div className="trusted-portrait-library">
        <div>
          <span className="eyebrow">素材库白名单</span>
          <strong>同步可用于 Seedance 的人物资源</strong>
        </div>
        <label>
          <span>资源类型</span>
          <select
            value={libraryGroupType}
            disabled={busyAction !== null}
            onChange={(event) => {
              setLibraryGroupType(event.target.value)
              setLibraryPortraits([])
              setLibraryLoaded(false)
            }}
          >
            <option value="AIGC">AI 虚拟人物</option>
            <option value="LivenessFace">已授权真人</option>
          </select>
        </label>
        <button
          className="button secondary"
          type="button"
          disabled={busyAction !== null || !configuration?.configured || !onListTrustedPortraits}
          onClick={() =>
            void run('list', async () => {
              const items = await onListTrustedPortraits(libraryGroupType)
              setLibraryPortraits(items)
              setLibraryLoaded(true)
              return null
            })
          }
        >
          {busyAction === 'list' ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
          {busyAction === 'list' ? '正在同步' : '同步白名单'}
        </button>
      </div>

      {libraryLoaded && (
        <p className="trusted-library-summary">
          共 {libraryPortraits.length} 项，{activeLibraryPortraits.length} 项可用
        </p>
      )}

      {libraryLoaded && libraryPortraits.length > 0 && (
        <div className="trusted-portrait-grid" aria-label="可信人像素材列表">
          {libraryPortraits.map((item) => {
            const selectable = item.status === 'active'
            const selected = providerAssetId === item.assetId
            const itemPreviewUrl = portraitPreviewUrl(item)
            return (
              <article
                className={`trusted-portrait-card ${selected ? 'selected' : ''} ${!selectable ? 'disabled' : ''}`}
                key={`${item.groupType}-${item.assetId}`}
              >
                <button
                  className="trusted-portrait-card-preview"
                  type="button"
                  disabled={!itemPreviewUrl}
                  aria-label={`放大查看${item.name || item.assetId}`}
                  onClick={() =>
                    itemPreviewUrl &&
                    onPreview?.({
                      url: itemPreviewUrl,
                      name: item.name || item.assetId,
                    })
                  }
                >
                  {itemPreviewUrl ? <img src={itemPreviewUrl} alt="" /> : <Images size={22} />}
                </button>
                <button
                  className="trusted-portrait-card-select"
                  type="button"
                  disabled={!selectable || busyAction !== null}
                  onClick={() => setProviderAssetId(item.assetId)}
                >
                  <span className="trusted-portrait-card-title">
                    <strong>{item.name || '未命名人像'}</strong>
                    {selected && <CheckCircle2 size={14} />}
                  </span>
                  <code>{item.assetId}</code>
                  <small>
                    {selected
                      ? '已选择，点击下方完成绑定'
                      : selectable
                        ? '点击选择'
                        : trustedLibraryStatus(item.status)}
                  </small>
                </button>
              </article>
            )
          })}
        </div>
      )}
      {libraryLoaded && libraryPortraits.length === 0 && (
        <p className="trusted-library-empty">
          当前分类没有同步到人像资源，请检查分类或让弦序先完成素材上传。
        </p>
      )}

      <div className="trusted-portrait-bind-row">
        <label>
          <span>已选人像 Asset ID（也可手动输入）</span>
          <input
            value={providerAssetId}
            placeholder="先点击上方人像卡片，或输入 asset ID"
            onChange={(event) => setProviderAssetId(event.target.value)}
          />
        </label>
        <button
          className="button primary"
          type="button"
          disabled={!assetId || !providerAssetId.trim() || busyAction !== null || !configuration?.configured}
          onClick={() => void run('bind', () => onBindTrustedPortrait(assetId, providerAssetId.trim()))}
        >
          {busyAction === 'bind' ? <LoaderCircle size={15} className="spin" /> : <Link2 size={15} />}
          校验并绑定
        </button>
        {configuration?.authorizationUrl && (
          <a
            className="button secondary"
            href={configuration.authorizationUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} />
            真人授权
          </a>
        )}
      </div>

      {!configuration?.configured && configuration !== null && (
        <p className="trusted-portrait-notice">服务端尚未配置素材库访问密钥 AK/SK，当前只能编辑人物设定。</p>
      )}
      {configuration?.configured && !assetId && (
        <p className="trusted-portrait-notice">
          首次创建会先保存当前人物资产，再把已确认的面部基准提交到弦序素材库。
        </p>
      )}
      {configuration?.configured && attributes.faceStatus !== 'approved' && (
        <p className="trusted-portrait-notice">请先在上方将一张面部候选图设置为面部基准。</p>
      )}
      {status === 'processing' && (
        <p className="trusted-portrait-state processing" role="status" aria-live="polite">
          <LoaderCircle size={13} className="spin" />
          已提交上游验证，系统会自动同步结果；验证通过后才可用于视频生成。
        </p>
      )}
      {status === 'active' && (
        <p className="trusted-portrait-state active" role="status" aria-live="polite">
          <CheckCircle2 size={13} />
          虚拟人像验证通过，后续 Seedance 视频任务会自动使用这个人像资源。
        </p>
      )}
      {portrait?.status === 'failed' && (
        <p className="trusted-portrait-error">
          {portrait.errorMessage || portrait.errorCode || '上游审核未通过，请检查正面图清晰度和人脸一致性。'}
        </p>
      )}
      {pollError && status === 'processing' && (
        <p className="trusted-portrait-error" role="alert">
          自动同步暂时失败：{pollError}。系统会继续重试，也可以点击“刷新状态”。
        </p>
      )}
      {error && (
        <p className="trusted-portrait-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function portraitPreviewUrl(portrait) {
  if (!portrait) return null
  if (portrait.assetId && portrait.status === 'active') {
    return `/api/v1/trusted-assets/portraits/${encodeURIComponent(portrait.assetId)}/preview`
  }
  return portrait.status === 'active' ? portrait.previewUrl || null : null
}

function StagePanel({
  eyebrow,
  title,
  description,
  task,
  reference,
  previewMode = 'cover',
  emptyText,
  onPreview,
  showTaskState = true,
  children,
}) {
  return (
    <div className="character-stage-panel">
      <div className="character-stage-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className={`character-stage-preview ${previewMode === 'contain' ? 'contain' : ''}`}>
        {reference?.url ? (
          <button type="button" aria-label={`放大查看${title}`} onClick={() => onPreview(reference)}>
            <img src={reference.url} alt={title} />
          </button>
        ) : (
          <div className="character-stage-empty">
            <ScanFace size={25} />
            <span>{emptyText}</span>
          </div>
        )}
        {showTaskState && task && <TaskState task={task} />}
      </div>
      <div className="character-stage-actions">{children}</div>
    </div>
  )
}

function TaskState({ task }) {
  const failed = task.status === 'failed' || task.status === 'cancelled'
  const completed = task.status === 'completed'
  const running = task.status === 'running'
  const label = completed
    ? '资产已生成'
    : failed
      ? task.status === 'cancelled'
        ? '已取消'
        : '生成失败'
      : task.status === 'queued' || task.status === 'paused'
        ? '等待生成'
        : '生成中'

  return (
    <div
      className={`character-task-state ${completed ? 'completed' : ''} ${failed ? 'failed' : ''}`}
      role="status"
      aria-live="polite"
    >
      {failed ? (
        <AlertCircle size={12} />
      ) : completed ? (
        <CheckCircle2 size={12} />
      ) : (
        <LoaderCircle size={12} className={running ? 'spin' : ''} />
      )}
      <span>{label}</span>
      {running && typeof task.progress === 'number' && <b>{task.progress}%</b>}
      {failed && task.error && <small>{readableTaskError(task.error)}</small>}
    </div>
  )
}

function TurnaroundPreview({ task, onPreview }) {
  if (!task || task.status !== 'completed') {
    return (
      <div className="turnaround-empty">
        <Images size={28} />
        <span>
          {task?.status === 'paused'
            ? '源图生成已暂停'
            : isActive(task)
              ? `正在生成源图 ${task.progress}%`
              : '完成面部和全身定稿后生成'}
        </span>
      </div>
    )
  }
  const outputs = task.outputs.slice(0, 3)
  return (
    <div className="turnaround-sheet-preview">
      {outputs.map((output) => (
        <div key={output.id}>
          <button
            type="button"
            aria-label={`放大查看${viewLabel(output.view)}`}
            onClick={() => onPreview(output)}
          >
            <img src={output.url} alt={viewLabel(output.view)} />
          </button>
          <span>{viewLabel(output.view)}</span>
        </div>
      ))}
    </div>
  )
}

function completedOutput(task) {
  if (task?.status !== 'completed') return null
  return (
    task.outputs.find((output) => output.mediaType === 'image' && output.view === 'single') ||
    task.outputs.find((output) => output.mediaType === 'image') ||
    null
  )
}

function virtualPortraitRegistrationBlocker({
  assetId,
  canEnsureAsset,
  configuration,
  faceStatus,
  portrait,
  busyAction,
}) {
  if (busyAction === 'register') return '正在提交创建申请，请等待当前操作完成'
  if (busyAction !== null) return '请等待当前素材库操作完成'
  if (!assetId && !canEnsureAsset) return '请先保存人物资产'
  if (!configuration) return '正在检查弦序素材库配置'
  if (!configuration.configured) return '服务端尚未配置素材库 Access Key / Secret Key'
  if (!configuration.virtualRegistrationReady) return '缺少公网 API 地址，弦序无法下载面部基准'
  if (faceStatus !== 'approved') return '请先在面部定稿步骤确认面部基准'
  if (portrait?.status === 'processing') return '已提交上游处理中，请等待自动同步或手动刷新'
  if (portrait?.status === 'active') return '已绑定可用人像资源，无需重复创建'
  if (portrait && portrait.status !== 'failed') return '当前人像状态暂不支持重新提交'
  return ''
}

function registrationAvailabilityHint(blocker) {
  if (blocker) return `当前不能创建：${blocker}。`
  return '面部基准已确认，可以提交 AI 人像资源；提交后需等待弦序审核通过。'
}

function isActive(task) {
  return task?.status === 'queued' || task?.status === 'paused' || task?.status === 'running'
}

function latestStageTask(tasks, stage) {
  return (
    tasks
      .filter(
        (task) =>
          task.metadata?.generationStage === stage && typeof task.metadata?.queueHiddenAt !== 'string',
      )
      .sort((left, right) => taskTime(right) - taskTime(left))[0] || null
  )
}

function taskTime(task) {
  const value = Date.parse(task.updatedAt || task.createdAt || '')
  return Number.isFinite(value) ? value : 0
}

function readableTaskError(error) {
  if (!error) return ''
  if (/aborted due to timeout|timed out|timeout/i.test(error)) {
    return '第三方图片生成请求超时，本次图片没有生成成功；请稍后重试'
  }
  if (/524:\s*A timeout occurred/i.test(error) || /TokenAdvent 图片请求失败 \(524\)/.test(error)) {
    return '上游图片服务超时（524），本次图片没有生成成功；请稍后重试'
  }
  return error
}

function trustedLibraryStatus(status) {
  return { active: '可绑定', processing: '上游处理中', failed: '审核失败' }[status] || status
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
