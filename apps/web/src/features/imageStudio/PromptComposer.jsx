import { Sparkles } from 'lucide-react'
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
  submitting,
  disabled,
  onPromptChange,
  onNegativePromptChange,
  onSubmit,
  error,
}) {
  const submitDisabled = disabled || submitting
  const balanceClass = estimatedCredits > availableCredits ? 'image2-balance warning' : 'image2-balance'

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

      <label className="image2-field">
        <span>主提示词</span>
        <textarea
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
          <button className="button primary image2-submit" type="button" disabled={submitDisabled} onClick={onSubmit}>
            {submitting ? <Sparkles size={15} className="spin" /> : <Sparkles size={15} />}
            <span>提交批次</span>
          </button>
        </div>
      </div>
    </section>
  )
}
