import { FileAudio, ImagePlus, LoaderCircle, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'

export function ReferenceUploader({ kind, references, onChange, onUpload }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const limit = kind === 'audio' ? 1 : 3
  const isAudio = kind === 'audio'

  const handleFiles = async (files) => {
    const selected = [...files].slice(0, limit - references.length)
    if (!selected.length) return
    setUploading(true)
    setError('')
    try {
      const uploaded = []
      for (const file of selected) uploaded.push(await onUpload(file))
      onChange([...references, ...uploaded.map(({ id, url, name }) => ({ id, url, name }))])
    } catch (uploadError) {
      setError(uploadError.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="reference-uploader">
      <div className="reference-head">
        <div>
          <strong>{isAudio ? '音频文件' : '参考图片'}</strong>
          <small>{isAudio ? '支持 MP3、WAV、OGG，最多 1 个文件' : '支持 JPG、PNG、WebP，最多 3 张'}</small>
        </div>
        <span>
          {references.length}/{limit}
        </span>
      </div>
      <div className="reference-list">
        {references.map((reference) => (
          <div className="reference-item" key={reference.id}>
            {isAudio ? <FileAudio size={25} /> : <img src={reference.url} alt={reference.name} />}
            <span title={reference.name}>{reference.name}</span>
            <button
              type="button"
              aria-label={`移除 ${reference.name}`}
              onClick={() => onChange(references.filter((item) => item.id !== reference.id))}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {references.length < limit && (
          <label className="reference-add">
            <input
              type="file"
              multiple={!isAudio}
              accept={
                isAudio ? 'audio/mpeg,audio/wav,audio/ogg,audio/mp4' : 'image/jpeg,image/png,image/webp'
              }
              onChange={(event) => void handleFiles(event.target.files || [])}
            />
            {uploading ? (
              <LoaderCircle size={22} className="spin" />
            ) : isAudio ? (
              <Upload size={22} />
            ) : (
              <ImagePlus size={22} />
            )}
            <span>{uploading ? '上传中' : '从本地导入'}</span>
          </label>
        )}
      </div>
      {error && <p className="reference-error">{error}</p>}
    </div>
  )
}
