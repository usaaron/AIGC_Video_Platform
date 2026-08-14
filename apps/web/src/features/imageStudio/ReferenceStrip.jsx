import { ImagePlus, LoaderCircle, X } from 'lucide-react'

const roleOptions = [
  { value: 'subject', label: '主体' },
  { value: 'style', label: '风格' },
  { value: 'composition', label: '构图' },
]

export function ReferenceStrip({ references, uploading, disabled, onUpload, onRemove, onRoleChange }) {
  return (
    <section className="image2-panel image2-reference-strip" aria-label="引用图">
      <div className="image2-panel-head">
        <div>
          <span className="eyebrow">引用图</span>
          <strong>{references.length} / 3</strong>
        </div>
        <label className={`image2-upload ${disabled || uploading ? 'disabled' : ''}`}>
          {uploading ? <LoaderCircle size={14} className="spin" /> : <ImagePlus size={14} />}
          <span>{uploading ? '上传中' : '添加'}</span>
          <input
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled || uploading}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onUpload(file)
            }}
          />
        </label>
      </div>

      <div className="image2-reference-list">
        {references.map((reference, index) => (
          <figure key={reference.mediaId}>
            <img src={reference.url} alt={`参考图 ${index + 1}`} />
            <figcaption>
              <strong>参考 {index + 1}</strong>
              <select
                aria-label={`参考 ${index + 1} 角色`}
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
            <button type="button" aria-label={`移除参考 ${index + 1}`} onClick={() => onRemove(reference.mediaId)}>
              <X size={12} />
            </button>
          </figure>
        ))}
        {!references.length && (
          <div className="image2-reference-empty">
            <ImagePlus size={18} />
            <span>可选上传角色、场景或风格参考</span>
          </div>
        )}
      </div>
    </section>
  )
}
