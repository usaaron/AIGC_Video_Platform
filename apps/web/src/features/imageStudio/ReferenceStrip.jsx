import { Hash, ImagePlus, LoaderCircle, X } from 'lucide-react'
import { IMAGE2_MAX_INPUT_IMAGES } from '@seqora/contracts'

const roleOptions = [
  { value: 'subject', label: '主体' },
  { value: 'clothing', label: '服装' },
  { value: 'accessory', label: '帽子/配饰' },
  { value: 'style', label: '风格' },
  { value: 'composition', label: '构图' },
  { value: 'color', label: '色调' },
]

export function ReferenceStrip({
  references,
  uploading,
  disabled,
  warnings = [],
  onUpload,
  onRemove,
  onRoleChange,
  onInsertReference,
}) {
  return (
    <section className="image2-panel image2-reference-strip" aria-label="引用图">
      <div className="image2-panel-head">
        <div>
          <span className="eyebrow">引用图</span>
          <strong>
            {references.length} / {IMAGE2_MAX_INPUT_IMAGES}
          </strong>
        </div>
        <label className={`image2-upload ${disabled || uploading ? 'disabled' : ''}`}>
          {uploading ? <LoaderCircle size={14} className="spin" /> : <ImagePlus size={14} />}
          <span>{uploading ? '上传中' : disabled ? '已满' : '添加'}</span>
          <input
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled || uploading}
            multiple
            type="file"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              if (files.length) onUpload(files)
            }}
          />
        </label>
      </div>

      <div className="image2-reference-list">
        {references.map((reference) => (
          <figure key={reference.mediaId} data-role={reference.role}>
            <img src={reference.url} alt={`图 ${reference.inputNumber}`} />
            <figcaption>
              <button
                className="image2-reference-number"
                type="button"
                title={`插入图 ${reference.inputNumber}`}
                onClick={() => onInsertReference?.(reference.inputNumber)}
              >
                <Hash size={10} />
                <span>图 {reference.inputNumber}</span>
              </button>
              <select
                aria-label={`图 ${reference.inputNumber} 角色`}
                value={reference.role}
                onChange={(event) => onRoleChange(reference.mediaId, event.target.value)}
              >
                {roleOptions.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </figcaption>
            <button
              type="button"
              aria-label={`移除图 ${reference.inputNumber}`}
              onClick={() => onRemove(reference.mediaId)}
            >
              <X size={12} />
            </button>
          </figure>
        ))}
        {!references.length && (
          <div className="image2-reference-empty">
            <ImagePlus size={18} />
            <span>添加主体、服装或风格参考</span>
          </div>
        )}
      </div>
      {warnings.length > 0 && (
        <div className="image2-reference-warnings" role="status" aria-live="polite">
          {warnings.map((warning) => (
            <span key={warning}>引用检查：{warning}</span>
          ))}
        </div>
      )}
    </section>
  )
}
