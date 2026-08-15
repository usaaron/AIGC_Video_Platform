import { useEffect, useRef } from 'react'
import { Clapperboard, Eye, Sparkles } from 'lucide-react'
import { GenerationSettings } from './GenerationSettings'
import { IMAGE2_PROMPT_TEMPLATES } from './promptTemplates'

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
  insertRequest,
  onPromptChange,
  onNegativePromptChange,
  onSubmit,
  error,
}) {
  const promptInputRef = useRef(null)
  const lastInsertNonce = useRef(null)
  const submitDisabled = disabled || submitting
  const balanceClass = estimatedCredits > availableCredits ? 'image2-balance warning' : 'image2-balance'

  useEffect(() => {
    if (!insertRequest || lastInsertNonce.current === insertRequest.nonce) return
    lastInsertNonce.current = insertRequest.nonce
    insertPromptAtCursor(promptInputRef.current, prompt, insertRequest.text, onPromptChange)
  }, [insertRequest, onPromptChange, prompt])

  return (
    <section className="image2-panel image2-composer" aria-label="提示词编写">
      <div className="image2-panel-head">
        <div>
          <span className="eyebrow">提示词</span>
          <strong>文本与约束</strong>
        </div>
        <span className={balanceClass}>
          预计 {estimatedCredits} / 可用 {availableCredits}
        </span>
      </div>

      <div className="image2-template-row">
        <div className="image2-template-label">
          <Clapperboard size={14} />
          <span>影视模板</span>
        </div>
        <select
          aria-label="序幕 TV 影视制作提示词模板"
          value=""
          onChange={(event) => {
            const template = IMAGE2_PROMPT_TEMPLATES.find((item) => item.id === event.target.value)
            if (template)
              insertPromptAtCursor(promptInputRef.current, prompt, template.prompt, onPromptChange)
          }}
        >
          <option value="" disabled>
            选择序幕 TV模板
          </option>
          {IMAGE2_PROMPT_TEMPLATES.map((template) => (
            <option key={template.id} value={template.id}>
              {template.label}
            </option>
          ))}
        </select>
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
        <span>负向提示词</span>
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
          title="由服务端使用 gpt-5.4 优化本次提示词"
          onChange={(checked) => onAssistChange({ ...assist, promptOptimization: checked })}
        />
        <AssistToggle
          checked={assist.referenceVision}
          disabled={submitting}
          icon={<Eye size={13} />}
          label="引用图视觉解析"
          title="由服务端把引用图转成文字描述后参与生成"
          onChange={(checked) => onAssistChange({ ...assist, referenceVision: checked })}
        />
      </div>

      <div className="image2-composer-foot">
        <div className="image2-param-panel">
          <div className="image2-param-panel-head">
            <strong>生成参数</strong>
            <span>尺寸、清晰度和张数</span>
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
          <p className="image2-composer-note">{error || '生成配置由服务端托管。'}</p>
          <button
            className="button primary image2-submit"
            type="button"
            disabled={submitDisabled}
            onClick={onSubmit}
          >
            {submitting ? <Sparkles size={15} className="spin" /> : <Sparkles size={15} />}
            <span>提交批次</span>
          </button>
        </div>
      </div>
    </section>
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
