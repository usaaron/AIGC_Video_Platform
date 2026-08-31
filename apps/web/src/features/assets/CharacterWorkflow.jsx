import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  Images,
  LoaderCircle,
  Lock,
  LogOut,
  Save,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ImagePreviewModal } from '../../components/ImagePreviewModal'
import { confirmCharacterFace } from './assetDraft'
import { isTrustedPortraitTaskActive } from './assetTaskState'

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
  const [variantName, setVariantName] = useState('')
  const relatedTasks = assetId ? tasks.filter((task) => task.metadata?.assetId === assetId) : []
  const taskFor = (targetStage) => latestTask(relatedTasks, targetStage)
  const faceTask = taskFor('face')
  const bodyTask = taskFor('body')
  const turnaroundTask = taskFor('turnaround')
  const registrationTask = latestTask(relatedTasks, 'trusted-portrait')
  const registrationTaskActive = isTrustedPortraitTaskActive(attributes.trustedPortrait, registrationTask)
  const generatedFaceCandidate = completedOutput(faceTask)
  const completedFaceTask = latestCompletedTask(relatedTasks, 'face')
  const completedFaceCandidate = completedOutput(completedFaceTask)
  const faceCandidate = faceCreationMode === 'direct' ? references[0] || null : generatedFaceCandidate
  const confirmedOrCompletedFace =
    faceCreationMode === 'direct' ? references[0] || null : completedFaceCandidate
  const facePreview =
    faceCandidate || confirmedOrCompletedFace || attributes.faceReference || references[0] || null
  const bodyCandidate = completedOutput(bodyTask)
  const appearanceVariants = Array.isArray(attributes.appearanceVariants) ? attributes.appearanceVariants : []
  const activeAppearanceVariantId = attributes.activeAppearanceVariantId || null
  const activeAppearanceVariant =
    appearanceVariants.find((variant) => variant.id === activeAppearanceVariantId) || null

  useEffect(() => {
    if (stage !== 'turnaround' || variantName.trim()) return
    setVariantName(`${assetName || '人物'} · 造型 ${appearanceVariants.length + 1}`)
  }, [assetName, appearanceVariants.length, stage, variantName])

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

  const saveAppearanceVariant = async () => {
    const references = (turnaroundTask?.outputs || [])
      .filter((output) => output.mediaType === 'image' && output.url)
      .slice(0, 3)
      .map((output) => toReference(output, `${assetName || '人物'}-${viewLabel(output.view)}`))
    const bodyReference =
      attributes.bodyReference ||
      (bodyCandidate ? toReference(bodyCandidate, `${assetName || '人物'}-全身基准`) : null)
    if (!bodyReference) throw new Error('请先确认一整套身体图，再保存人物版本')
    if (references.length < 3) throw new Error('请等待正面、侧面、背面三张三视图全部生成')
    const name = variantName.trim()
    if (!name) throw new Error('请给这套身体图/三视图填写人物版本名称')
    const now = new Date().toISOString()
    const variant = {
      id: createVariantId(),
      name,
      bodyReference,
      turnaroundReferences: references,
      turnaroundLayout: attributes.turnaroundLayout || 'sheet',
      createdAt: now,
      updatedAt: now,
    }
    const next = {
      ...attributes,
      appearanceVariants: [...appearanceVariants, variant].slice(-12),
      activeAppearanceVariantId: variant.id,
    }
    if (await persist(next)) setVariantName('')
  }

  const activateAppearanceVariant = async (variant) => {
    const next = {
      ...attributes,
      bodyStatus: 'approved',
      bodyReference: variant.bodyReference,
      turnaround: true,
      activeAppearanceVariantId: variant.id,
      turnaroundLayout: variant.turnaroundLayout || attributes.turnaroundLayout,
    }
    await persist(next)
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
          showTaskState={false}
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

      {attributes.subjectType === 'human' && (
        <TrustedPortraitPanel
          assetId={assetId}
          assetName={assetName}
          attributes={attributes}
          registrationTask={registrationTask}
          registrationTaskActive={registrationTaskActive}
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
            variant={activeAppearanceVariant}
            onPreview={(output) =>
              setPreview({
                url: output.url,
                alt: `${assetName || '人物'}${viewLabel(output.view)}视图`,
                fileName: `${assetName || '人物'}-${viewLabel(output.view)}视图`,
              })
            }
          />
          <AppearanceVariantPanel
            assetName={assetName}
            variants={appearanceVariants}
            activeVariantId={activeAppearanceVariantId}
            variantName={variantName}
            canSave={turnaroundTask?.status === 'completed'}
            onVariantNameChange={setVariantName}
            onSave={() => void saveAppearanceVariant().catch((saveError) => setError(saveError.message))}
            onActivate={(variant) => void activateAppearanceVariant(variant)}
            onPreview={(reference) =>
              setPreview({
                url: reference.url,
                alt: `${assetName || '人物'}${reference.name || '造型版本'}`,
                fileName: reference.name || `${assetName || '人物'}-造型版本`,
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
  assetName,
  attributes,
  registrationTask,
  registrationTaskActive,
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
  const refreshTrustedPortraitRef = useRef(onRefreshTrustedPortrait)
  const attributesChangeRef = useRef(onAttributesChange)
  const portrait = attributes.trustedPortrait
  const registrationTaskFailed = portrait?.status !== 'active' && registrationTask?.status === 'failed'
  const status = registrationTaskActive
    ? 'processing'
    : registrationTaskFailed && portrait?.status !== 'active'
      ? 'failed'
      : portrait?.status || 'unlinked'
  const statusLabels = {
    unlinked: '未绑定',
    processing: registrationTaskActive ? '后台任务处理中' : '上游处理中',
    active: '可用于视频',
    failed: '审核失败',
  }
  const activeLibraryPortraits = libraryPortraits.filter((item) => item.status === 'active')
  const registrationHint = registrationAvailabilityHint(configuration, attributes.faceStatus)
  const boundPreviewUrl = portraitPreviewUrl(portrait)
  const registrationDisabledReason = registrationAvailabilityHint(configuration, attributes.faceStatus)
  const registrationSetupBlocked = Boolean(configuration && !configuration.virtualRegistrationReady)

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
    let pollAttempt = 0

    const poll = async () => {
      try {
        const updated = await refreshTrustedPortraitRef.current(assetId)
        if (cancelled) return
        pollAttempt = 0
        setPollError('')
        if (updated?.attributes) attributesChangeRef.current(updated.attributes)
        if (updated?.attributes?.trustedPortrait?.status === 'processing') {
          timer = window.setTimeout(poll, 6_000)
        }
      } catch (pollingError) {
        if (cancelled) return
        pollAttempt += 1
        // AIGC resources are eventually consistent upstream; avoid showing a red error for one transient lookup.
        if (pollAttempt >= 3) {
          setPollError(pollingError instanceof Error ? pollingError.message : '自动同步上游状态失败')
        }
        timer = window.setTimeout(poll, Math.min(30_000, 8_000 * 2 ** Math.min(pollAttempt - 1, 2)))
      }
    }

    timer = window.setTimeout(poll, 5_000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [assetId, portrait?.status])

  const run = async (action, callback) => {
    setBusyAction(action)
    setError('')
    if (action === 'register' || action === 'refresh') setPollError('')
    try {
      const updated = await callback()
      if (updated?.attributes) onAttributesChange(updated.attributes)
    } catch (actionError) {
      setError(actionError.message)
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
              <img src={boundPreviewUrl} alt="" loading="eager" decoding="async" />
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
        <span
          className={`trusted-portrait-action-tooltip ${registrationSetupBlocked ? 'is-blocked' : ''}`}
          title={registrationDisabledReason || '创建 AI 人像资源'}
        >
          <button
            className={`button secondary ${registrationSetupBlocked ? 'requires-setup' : ''}`}
            type="button"
            disabled={
              (!assetId && !onEnsureAsset) ||
              attributes.faceStatus !== 'approved' ||
              portrait?.status === 'processing' ||
              portrait?.status === 'active' ||
              registrationTaskActive ||
              busyAction !== null
            }
            aria-describedby={registrationHint ? 'trusted-portrait-registration-hint' : undefined}
            onClick={() => {
              if (!configuration?.virtualRegistrationReady) {
                setError(registrationDisabledReason || '素材库配置尚未完成，暂时无法创建 AI 人像资源')
                return
              }
              if (!onRegisterVirtualPortrait) {
                setError('AI 人像资源任务接口未连接，请刷新页面后重试')
                return
              }
              void run('register', async () => {
                const persisted = assetId ? { id: assetId } : await onEnsureAsset?.()
                if (!persisted?.id) throw new Error('请先保存人物资产，再创建 AI 人像资源')
                return onRegisterVirtualPortrait(persisted.id, assetName)
              })
            }}
          >
            {busyAction === 'register' || registrationTaskActive ? (
              <LoaderCircle size={15} className="spin" />
            ) : portrait?.status === 'active' ? (
              <CheckCircle2 size={15} />
            ) : (
              <CloudUpload size={15} />
            )}
            {portrait?.status === 'active'
              ? 'AI 人像已可用'
              : registrationTaskActive
                ? registrationTask?.status === 'queued'
                  ? '等待创建资源'
                  : '正在创建资源'
                : !configuration
                  ? '正在检查配置'
                  : !configuration.virtualRegistrationReady
                    ? '需要公网地址'
                    : registrationTaskFailed || portrait?.status === 'failed'
                      ? '重试 AI 人像资源'
                      : portrait?.groupType === 'AIGC'
                        ? '重新提交 AI 人像'
                        : '创建 AI 人像资源'}
          </button>
        </span>

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
        <p
          id="trusted-portrait-registration-hint"
          className={`trusted-portrait-registration-hint ${registrationSetupBlocked ? 'is-blocked' : ''}`}
          role="status"
          aria-live="polite"
        >
          <AlertCircle size={13} />
          <span>{registrationHint}</span>
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
              const currentIsActive = items.some(
                (item) => item.assetId === portrait?.assetId && item.status === 'active',
              )
              if (
                assetId &&
                portrait?.status === 'processing' &&
                currentIsActive &&
                onRefreshTrustedPortrait
              ) {
                return onRefreshTrustedPortrait(assetId)
              }
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
                  {itemPreviewUrl ? (
                    <img src={itemPreviewUrl} alt="" loading="eager" decoding="async" />
                  ) : (
                    <Images size={22} />
                  )}
                </button>
                <button
                  className="trusted-portrait-card-select"
                  type="button"
                  disabled={!selectable || busyAction !== null}
                  onClick={() =>
                    void run('bind', async () => {
                      const persisted = assetId ? { id: assetId } : await onEnsureAsset?.()
                      if (!persisted?.id) throw new Error('请先保存人物资产，再绑定人像资源')
                      setProviderAssetId(item.assetId)
                      return onBindTrustedPortrait(persisted.id, item.assetId)
                    })
                  }
                >
                  <span className="trusted-portrait-card-title">
                    <strong>{item.name || '未命名人像'}</strong>
                    {selected && <CheckCircle2 size={14} />}
                  </span>
                  <code>{item.assetId}</code>
                  <small>
                    {selected
                      ? '已绑定到当前人物'
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

      <div className="trusted-portrait-bind-row trusted-portrait-bind-info">
        <span>选择可用人像后会自动绑定到当前人物资产。</span>
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
          {registrationTask?.error ||
            portrait.errorMessage ||
            portrait.errorCode ||
            '上游审核未通过，请检查正面图清晰度和人脸一致性。'}
        </p>
      )}
      {registrationTaskFailed && portrait?.status !== 'failed' && (
        <p className="trusted-portrait-error" role="alert">
          {registrationTask.error || '人像资源任务失败，可以直接重试；已保留原人物面部基准。'}
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

function latestTask(tasks, generationStage) {
  return tasks
    .filter((task) => matchesGenerationStage(task, generationStage))
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left))[0]
}

function latestCompletedTask(tasks, generationStage) {
  return tasks
    .filter(
      (task) =>
        matchesGenerationStage(task, generationStage) &&
        task.status === 'completed' &&
        Boolean(completedOutput(task)),
    )
    .sort((left, right) => taskTimestamp(right) - taskTimestamp(left))[0]
}

function matchesGenerationStage(task, generationStage) {
  if (task.metadata?.generationStage === generationStage) return true
  return (
    generationStage === 'face' &&
    !task.metadata?.generationStage &&
    task.metadata?.assetKind === 'character' &&
    task.metadata?.turnaround !== true
  )
}

function taskTimestamp(task) {
  const value = Date.parse(task.updatedAt || task.createdAt || '')
  return Number.isFinite(value) ? value : 0
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
    </div>
  )
}

function TurnaroundPreview({ task, variant, onPreview }) {
  const outputs = variant?.turnaroundReferences?.length
    ? variant.turnaroundReferences.slice(0, 3).map((reference, index) => ({
        ...reference,
        mediaType: 'image',
        view: ['front', 'side', 'back'][index],
      }))
    : task?.status === 'completed'
      ? task.outputs.slice(0, 3)
      : []
  if (!outputs.length) {
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

function AppearanceVariantPanel({
  assetName,
  variants,
  activeVariantId,
  variantName,
  canSave,
  onVariantNameChange,
  onSave,
  onActivate,
  onPreview,
}) {
  return (
    <section className="appearance-variant-panel">
      <div className="appearance-variant-head">
        <div>
          <span className="eyebrow">人物版本 / 造型版本</span>
          <h3>保存一整套身体图 / 三视图</h3>
          <p>每套版本独立命名，后续剧本和分镜可继续使用当前版本。</p>
        </div>
        <label className="appearance-variant-name">
          <span>版本名称</span>
          <input
            className="text-input"
            value={variantName}
            maxLength={80}
            placeholder={`${assetName || '人物'} · 日常装`}
            onChange={(event) => onVariantNameChange(event.target.value)}
          />
        </label>
        <button className="button primary" type="button" disabled={!canSave} onClick={onSave}>
          <Save size={15} />
          保存人物版本
        </button>
      </div>
      {variants.length > 0 ? (
        <div className="appearance-variant-list">
          {variants.map((variant) => (
            <article
              className={`appearance-variant-card ${variant.id === activeVariantId ? 'active' : ''}`}
              key={variant.id}
            >
              <button
                type="button"
                className="appearance-variant-preview"
                onClick={() => variant.bodyReference?.url && onPreview(variant.bodyReference)}
                disabled={!variant.bodyReference?.url}
                aria-label={`预览${variant.name}`}
              >
                {variant.bodyReference?.url ? (
                  <img src={variant.bodyReference.url} alt="" />
                ) : (
                  <UserRound size={18} />
                )}
              </button>
              <div className="appearance-variant-info">
                <strong>{variant.name}</strong>
                <span>身体图 + {variant.turnaroundReferences?.length || 0} 张三视图</span>
                {variant.id === activeVariantId && <small>当前使用</small>}
              </div>
              <div className="appearance-variant-views">
                {(variant.turnaroundReferences || []).slice(0, 3).map((reference, index) => (
                  <button
                    key={`${variant.id}-${reference.id || index}`}
                    type="button"
                    onClick={() => onPreview(reference)}
                    aria-label={`预览${variant.name}${['正面', '侧面', '背面'][index]}`}
                  >
                    <img src={reference.url} alt="" />
                  </button>
                ))}
              </div>
              <button
                className="button secondary compact"
                type="button"
                disabled={variant.id === activeVariantId}
                onClick={() => onActivate(variant)}
              >
                {variant.id === activeVariantId ? '已设为当前' : '使用这套造型'}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="appearance-variant-empty">生成三视图后，可以把这一整套身体图保存成可切换版本。</p>
      )}
    </section>
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

function registrationAvailabilityHint(configuration, faceStatus) {
  if (!configuration) return '正在检查弦序素材库配置。'
  if (faceStatus !== 'approved') return '请先创建任务大头照-设定面部基准后，再创建 AI 人像资源。'
  if (!configuration.configured) return '弦序素材库凭据尚未配置，请先使用下方素材库绑定已有资源。'
  if (!configuration.virtualRegistrationReady) {
    return '自动创建需要配置可公网访问的 API 地址，供弦序读取面部原图；本地可先在弦序上传，再从下方素材库绑定。'
  }
  return ''
}

function isActive(task) {
  return task?.status === 'queued' || task?.status === 'paused' || task?.status === 'running'
}

function trustedLibraryStatus(status) {
  return { active: '可绑定', processing: '上游处理中', failed: '审核失败' }[status] || status
}

function toReference(candidate, name) {
  return { id: candidate.id, url: candidate.url, name }
}

function createVariantId() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `appearance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
