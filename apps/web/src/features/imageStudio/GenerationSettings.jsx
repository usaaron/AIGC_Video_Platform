import { Images, Minus, Plus, Ratio, SlidersHorizontal } from 'lucide-react'
import { IMAGE2_IMAGE_SIZE_OPTIONS, IMAGE2_MAX_IMAGES } from '@seqora/contracts'

const imageSizeGroups = [
  {
    label: '智能',
    options: [{ value: 'auto', label: '自适应 auto（按提示词和模型默认）' }],
  },
  {
    label: '常用比例',
    options: [
      { value: '1024x1024', label: '方形 1:1 · 1024×1024（常用）' },
      { value: '1536x1024', label: '横版 3:2 · 1536×1024（经典）' },
      { value: '1024x1536', label: '竖版 2:3 · 1024×1536（经典）' },
      { value: '1365x1024', label: '横版 4:3 · 1365×1024（标准）' },
      { value: '1024x1365', label: '竖版 3:4 · 1024×1365（标准）' },
      { value: '1536x864', label: '横版 16:9 · 1536×864（宽屏）' },
      { value: '864x1536', label: '竖版 9:16 · 864×1536（竖屏）' },
      { value: '1280x1024', label: '横版 5:4 · 1280×1024（传统）' },
      { value: '1024x1280', label: '竖版 4:5 · 1024×1280（社媒）' },
    ],
  },
  {
    label: '高清输出',
    options: [
      { value: '2048x2048', label: '方图 2048×2048（2K）' },
      { value: '2560x1440', label: '横图 2560×1440（2K）' },
      { value: '1440x2560', label: '竖图 1440×2560（2K）' },
      { value: '3840x2160', label: '横图 3840×2160（4K，较慢）' },
      { value: '2160x3840', label: '竖图 2160×3840（4K，较慢）' },
    ],
  },
].map((group) => ({
  ...group,
  options: group.options.filter((option) => IMAGE2_IMAGE_SIZE_OPTIONS.includes(option.value)),
}))

const qualityOptions = [
  { value: 'low', label: '草稿' },
  { value: 'medium', label: '标准' },
  { value: 'high', label: '精细' },
]

export function GenerationSettings({
  aspectRatio,
  quality,
  imageCount,
  onAspectRatioChange,
  onQualityChange,
  onImageCountChange,
  compact = false,
}) {
  if (compact) {
    return (
      <div className="image2-settings-inline" aria-label="生成设置">
        <div className="image2-setting-group compact size">
          <span>
            <Ratio size={14} /> 画幅比例
          </span>
          <ImageSizeSelect value={aspectRatio} onChange={onAspectRatioChange} />
        </div>

        <div className="image2-setting-group compact quality">
          <span>
            <SlidersHorizontal size={14} /> 生成质量
          </span>
          <div className="image2-segmented compact" role="group" aria-label="生成质量">
            {qualityOptions.map((option) => (
              <button
                key={option.value}
                className={quality === option.value ? 'active' : ''}
                type="button"
                onClick={() => onQualityChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="image2-setting-group compact count">
          <span>
            <Images size={14} /> 张数
          </span>
          <ImageCountStepper value={imageCount} onChange={onImageCountChange} />
        </div>
      </div>
    )
  }

  return (
    <section className="image2-panel image2-settings" aria-label="生成设置">
      <div className="image2-panel-head">
        <div>
          <span className="eyebrow">设置</span>
          <strong>输出规格</strong>
        </div>
        <SlidersHorizontal size={16} />
      </div>

      <div className="image2-setting-group">
        <span>
          <Ratio size={14} /> 画幅比例
        </span>
        <ImageSizeSelect value={aspectRatio} onChange={onAspectRatioChange} />
      </div>

      <div className="image2-setting-group">
        <span>
          <SlidersHorizontal size={14} /> 生成质量
        </span>
        <div className="image2-segmented" role="group" aria-label="生成质量">
          {qualityOptions.map((option) => (
            <button
              key={option.value}
              className={quality === option.value ? 'active' : ''}
              type="button"
              onClick={() => onQualityChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="image2-setting-group">
        <span>
          <Images size={14} /> 张数
        </span>
        <ImageCountStepper value={imageCount} onChange={onImageCountChange} />
      </div>
    </section>
  )
}

function ImageSizeSelect({ value, onChange }) {
  return (
    <select
      className="image2-size-select"
      value={value}
      aria-label="画幅比例"
      onChange={(event) => onChange(event.target.value)}
    >
      {imageSizeGroups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function ImageCountStepper({ value, onChange }) {
  const setCount = (nextValue) => {
    const parsed = Number.parseInt(String(nextValue), 10)
    if (!Number.isFinite(parsed)) return
    onChange(Math.min(IMAGE2_MAX_IMAGES, Math.max(1, parsed)))
  }

  return (
    <div className="image2-stepper image2-count-stepper">
      <button
        type="button"
        aria-label="减少张数"
        disabled={value <= 1}
        title="减少张数"
        onClick={() => setCount(value - 1)}
      >
        <Minus size={13} />
      </button>
      <input
        aria-label="张数"
        inputMode="numeric"
        max={IMAGE2_MAX_IMAGES}
        min="1"
        step="1"
        type="number"
        value={value}
        onBlur={(event) => setCount(event.target.value || 1)}
        onChange={(event) => setCount(event.target.value)}
      />
      <button
        type="button"
        aria-label="增加张数"
        disabled={value >= IMAGE2_MAX_IMAGES}
        title="增加张数"
        onClick={() => setCount(value + 1)}
      >
        <Plus size={13} />
      </button>
    </div>
  )
}
