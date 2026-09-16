import { useRef, useState } from 'react'
import { Check, FolderOpen, ImagePlus, LoaderCircle, Upload, X } from 'lucide-react'
import { IconButton } from '../../components/ui'
import { getAssetPreviewUrl } from '../assets/assetPreview'

export function ShotReferenceGallery({
  images,
  assets,
  tasks,
  disabled,
  onUpload,
  onUploading,
  onAdd,
  onRemove,
}) {
  const [selected, setSelected] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const uploadLock = useRef(false)
  const index = Math.min(selected, Math.max(0, images.length - 1))
  const current = images[index]
  const available = assets
    .map((asset) => ({ asset, url: getAssetPreviewUrl(asset, tasks) }))
    .filter((item) => item.url)
  const upload = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length || uploadLock.current) return
    if (files.length + images.length > 9) {
      setError(`最多 9 张参考图，还可添加 ${9 - images.length} 张。`)
      return
    }
    uploadLock.current = true
    setUploading(true)
    onUploading(true)
    setError('')
    const added = []
    const failures = []
    try {
      for (const file of files) {
        try {
          const media = await onUpload(file)
          added.push({ url: media.url, name: file.name.slice(0, 200) })
        } catch (failure) {
          failures.push(`${file.name}：${failure.message || '上传失败'}`)
        }
      }
      if (added.length) {
        onAdd(added)
        setSelected(images.length)
      }
      setError(failures.join('；'))
    } catch (failure) {
      setError(failure.message)
    } finally {
      uploadLock.current = false
      setUploading(false)
      onUploading(false)
    }
  }
  return (
    <>
      <div className="shot-reference-heading">
        <strong>参考图</strong>
        <span>{images.length} / 9 张</span>
      </div>
      <div className={`shot-editor-reference-stage ${current ? 'has-image' : ''}`}>
        {current ? (
          <img src={current.url} alt="镜头参考" />
        ) : (
          <div className="shot-editor-reference-empty">
            <ImagePlus size={30} />
            <strong>添加本镜头参考图</strong>
            <span>可一次上传多张图片</span>
          </div>
        )}
      </div>
      {images.length > 0 && (
        <div className="shot-reference-thumbnails" aria-label="已添加参考图">
          {images.map((image, position) => (
            <div key={image.url} className={position === index ? 'selected' : ''}>
              <button
                type="button"
                aria-label={`预览图${position + 1}`}
                aria-pressed={position === index}
                onClick={() => setSelected(position)}
              >
                <img src={image.url} alt="" />
                <span>图{position + 1}</span>
              </button>
              <IconButton
                label={`移除图${position + 1}`}
                type="button"
                disabled={disabled}
                onClick={() => onRemove(position)}
              >
                <X size={12} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <p className="shot-reference-help">
        点击“本镜头资产”中的图1、图2，写入提示词，说明每张图的用途。连续镜头最多 8 张。
      </p>
      <div className="shot-reference-source-actions">
        <label className="button secondary">
          {uploading ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
          {uploading ? '上传中' : '本地上传'}
          <input
            className="hidden-input"
            aria-label="上传参考图（可多选）"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            disabled={disabled || images.length >= 9}
            onChange={(event) => void upload(event)}
          />
        </label>
        <button
          className={`button secondary ${pickerOpen ? 'active' : ''}`}
          type="button"
          disabled={disabled}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((value) => !value)}
        >
          <FolderOpen size={15} /> 选择项目参考图
        </button>
      </div>
      {error && (
        <p className="operation-error" role="alert">
          {error}
        </p>
      )}
      {pickerOpen && (
        <div className="shot-asset-picker">
          <div className="shot-asset-picker-head">
            <strong>项目参考图</strong>
            <span>{available.length} 张可用</span>
          </div>
          {available.length ? (
            <div className="shot-asset-picker-grid">
              {available.map(({ asset, url }) => {
                const chosen = images.some((image) => image.url === url)
                return (
                  <button
                    className={chosen ? 'selected' : ''}
                    type="button"
                    disabled={disabled || chosen || images.length >= 9}
                    key={asset.id}
                    aria-label={`使用资产 ${asset.name}`}
                    aria-pressed={chosen}
                    onClick={() => {
                      try {
                        onAdd([{ url, name: asset.name }])
                        setSelected(images.length)
                        setError('')
                      } catch (failure) {
                        setError(failure.message)
                      }
                    }}
                  >
                    <img src={url} alt="" />
                    <span>{asset.name}</span>
                    {chosen && <Check size={14} />}
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="shot-asset-picker-empty">
              <ImagePlus size={20} />
              <span>项目暂无可用图片</span>
            </div>
          )}
        </div>
      )}
    </>
  )
}
