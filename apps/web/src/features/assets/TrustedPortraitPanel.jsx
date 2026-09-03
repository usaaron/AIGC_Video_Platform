import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  ExternalLink,
  Images,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function TrustedPortraitPanel({
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
        // 上游最终一致，单次查询失败不应立刻打断用户流程。
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

export function portraitPreviewUrl(portrait) {
  if (!portrait) return null
  if (portrait.assetId && portrait.status === 'active') {
    return `/api/v1/trusted-assets/portraits/${encodeURIComponent(portrait.assetId)}/preview`
  }
  return portrait.status === 'active' ? portrait.previewUrl || null : null
}

export function registrationAvailabilityHint(configuration, faceStatus) {
  if (!configuration) return '正在检查弦序素材库配置。'
  if (faceStatus !== 'approved') return '请先创建任务大头照-设定面部基准后，再创建 AI 人像资源。'
  if (!configuration.configured) return '弦序素材库凭据尚未配置，请先使用下方素材库绑定已有资源。'
  if (!configuration.virtualRegistrationReady) {
    return '自动创建需要配置可公网访问的 API 地址，供弦序读取面部原图；本地可先在弦序上传，再从下方素材库绑定。'
  }
  return ''
}

function trustedLibraryStatus(status) {
  return { active: '可绑定', processing: '上游处理中', failed: '审核失败' }[status] || status
}
