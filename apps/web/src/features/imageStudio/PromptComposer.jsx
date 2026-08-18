import { useEffect, useRef } from 'react'
import { Coins, Eye, Images, Sparkles, Wallet, X } from 'lucide-react'
import { GenerationSettings } from './GenerationSettings'

export function PromptComposer({
  prompt,
  negativePrompt,
  availableCredits,
  estimatedCredits,
  aspectRatio,
  quality,
  imageCount,
  onAspectRatioChange,
  onQualityChange,
  onImageCountChange,
  assist,
  onAssistChange,
  submitting,
  disabled,
  submitConfirmOpen = false,
  onSubmitRequest,
  onConfirmSubmit,
  onCancelSubmit,
  insertRequest,
  onPromptChange,
  onNegativePromptChange,
  error,
}) {
  const promptInputRef = useRef(null)
  const confirmCancelRef = useRef(null)
  const lastInsertNonce = useRef(null)
  const submitDisabled = disabled || submitting || submitConfirmOpen
  const summaryWarning = estimatedCredits > availableCredits

  useEffect(() => {
    if (!insertRequest || lastInsertNonce.current === insertRequest.nonce) return
    lastInsertNonce.current = insertRequest.nonce
    insertPromptAtCursor(promptInputRef.current, prompt, insertRequest.text, onPromptChange)
  }, [insertRequest, onPromptChange, prompt])

  useEffect(() => {
    if (!submitConfirmOpen) return undefined
    const frame = window.requestAnimationFrame(() => confirmCancelRef.current?.focus())
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelSubmit?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.cancelAnimationFrame(frame)
    }
  }, [onCancelSubmit, submitConfirmOpen])

  return (
    <>
      <section className="image2-panel image2-composer" aria-label="提示词编排">
        <div className="image2-panel-head">
          <div>
            <span className="eyebrow">提示词</span>
            <strong>文本与约束</strong>
          </div>
        </div>

        <label className="image2-field">
          <span>主提示词</span>
          <textarea
            ref={promptInputRef}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="写清主体、场景、构图、光线、材质和镜头感觉。"
            rows={7}
          />
        </label>

        <label className="image2-field compact">
          <span>负面提示词</span>
          <input
            value={negativePrompt}
            onChange={(event) => onNegativePromptChange(event.target.value)}
            placeholder="watermark, low detail, blurry"
            type="text"
          />
        </label>

        <div className="image2-assist-row" aria-label="高级辅助能力">
          <AssistToggle
            checked={assist.promptOptimization}
            disabled={submitting}
            icon={<Sparkles size={13} />}
            label="提示词优化"
            title="由服务端使用 gpt-5.4 优化本次提示词。"
            onChange={(checked) => onAssistChange({ ...assist, promptOptimization: checked })}
          />
          <AssistToggle
            checked={assist.referenceVision}
            disabled={submitting}
            icon={<Eye size={13} />}
            label="引用图视觉解析"
            title="由服务端先把引用图转成文字描述再参与生成。"
            onChange={(checked) => onAssistChange({ ...assist, referenceVision: checked })}
          />
        </div>

        <div className="image2-composer-foot">
          <div className="image2-param-panel">
            <div className="image2-param-panel-head">
              <strong>生成参数</strong>
              <span>画幅比例、生成质量和张数</span>
            </div>
            <GenerationSettings
              compact
              aspectRatio={aspectRatio}
              quality={quality}
              imageCount={imageCount}
              onAspectRatioChange={onAspectRatioChange}
              onQualityChange={onQualityChange}
              onImageCountChange={onImageCountChange}
            />
          </div>
          <div className="image2-composer-actions">
            <div className={`image2-submit-summary ${summaryWarning ? 'warning' : ''}`} aria-label={`预计 ${estimatedCredits} / 可用 ${availableCredits}`}>
              <span>预计</span>
              <strong>{estimatedCredits}</strong>
              <span>/ 可用</span>
              <strong>{availableCredits}</strong>
            </div>
            <button
              className="button primary image2-submit"
              type="button"
              disabled={submitDisabled}
              onClick={onSubmitRequest}
            >
              {submitting ? <Sparkles size={15} className="spin" /> : <Sparkles size={15} />}
              <span>提交批次</span>
            </button>
            <p className="image2-composer-note">{error || '生成配置由服务端托管。'}</p>
          </div>
        </div>
      </section>

      {submitConfirmOpen && (
        <div className="modal-backdrop image2-submit-confirm-backdrop" onMouseDown={onCancelSubmit}>
          <section
            className="modal image2-submit-confirm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="image2-submit-confirm-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="image2-submit-confirm-head">
              <div>
                <span className="eyebrow">提交前确认</span>
                <h2 id="image2-submit-confirm-title">确认生成批次</h2>
              </div>
              <button
                ref={confirmCancelRef}
                type="button"
                className="button secondary image2-submit-confirm-close"
                aria-label="关闭确认框"
                onClick={onCancelSubmit}
              >
                <X size={16} />
              </button>
            </div>

            <div className="image2-submit-confirm-body">
              <p className="image2-submit-confirm-copy">
                本次将生成 <strong>{imageCount}</strong> 张图片，预计消耗 <strong>{estimatedCredits}</strong> 积分，
                当前余额 <strong>{availableCredits}</strong> 积分。
              </p>
              <div className="image2-submit-confirm-grid">
                <article className="image2-submit-confirm-stat">
                  <span>
                    <Images size={12} />
                    本次生成
                  </span>
                  <strong>{imageCount} 张</strong>
                  <small>提交后会按当前批次配置进入服务端队列。</small>
                </article>
                <article className={`image2-submit-confirm-stat ${summaryWarning ? 'warning' : ''}`}>
                  <span>
                    <Coins size={12} />
                    预计消耗
                  </span>
                  <strong>{estimatedCredits} 积分</strong>
                  <small>{summaryWarning ? '当前余额不足，确认后也无法完成提交。' : '将按提交时的服务端规则扣除。'}</small>
                </article>
                <article className="image2-submit-confirm-stat">
                  <span>
                    <Wallet size={12} />
                    当前余额
                  </span>
                  <strong>{availableCredits} 积分</strong>
                  <small>{summaryWarning ? `还差 ${estimatedCredits - availableCredits} 积分` : '余额足够完成本批次。'}</small>
                </article>
              </div>
            </div>

            <div className="modal-actions image2-submit-confirm-actions">
              <button type="button" className="button secondary" onClick={onCancelSubmit}>
                取消
              </button>
              <button
                type="button"
                className="button primary"
                disabled={submitting}
                onClick={onConfirmSubmit}
              >
                <Sparkles size={15} />
                确认生成
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

function insertPromptAtCursor(input, prompt, text, onPromptChange) {
  const currentPrompt = String(prompt || '')
  const start = input ? input.selectionStart : currentPrompt.length
  const end = input ? input.selectionEnd : currentPrompt.length
  const prefix = currentPrompt.slice(0, start)
  const suffix = currentPrompt.slice(end)
  const leadingSpace = prefix && !/\s$/.test(prefix) ? ' ' : ''
  const trailingSpace = suffix && !/^\s/.test(suffix) ? ' ' : ''
  const nextPrompt = `${prefix}${leadingSpace}${text}${trailingSpace}${suffix}`
  const nextCursor = prefix.length + leadingSpace.length + text.length
  onPromptChange(nextPrompt)
  requestAnimationFrame(() => {
    input?.focus()
    input?.setSelectionRange(nextCursor, nextCursor)
  })
}

function AssistToggle({ checked, disabled, icon, label, title, onChange }) {
  return (
    <label className={`image2-assist-toggle ${checked ? 'active' : ''}`} title={title}>
      <input
        checked={checked}
        disabled={disabled}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="image2-assist-switch" aria-hidden="true" />
      <span className="image2-assist-label">
        {icon}
        {label}
      </span>
    </label>
  )
}
