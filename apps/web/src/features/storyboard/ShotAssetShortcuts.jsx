import { Check, Package, MapPinned, Users, Images } from 'lucide-react'
import { characterVariantName } from '@seqora/contracts'
import { findAssetMentions } from '../assets/AssetShortcutBar'
import { getAssetPreviewUrl } from '../assets/assetPreview'
import { selectShotAssetsFromIndex } from './referenceSelector'

const groups = [
  { label: '人物', kinds: ['character'], Icon: Users },
  { label: '物品', kinds: ['prop', 'costume', 'brand'], Icon: Package },
  { label: '场景', kinds: ['scene'], Icon: MapPinned },
]

export function ShotAssetShortcuts({
  shot,
  assets,
  tasks,
  prompt,
  onInsert,
  disabled,
  referenceImages = [],
}) {
  const relevantIds = new Set(
    selectShotAssetsFromIndex(null, { ...shot, prompt }, assets).map((asset) => asset.id),
  )
  const mentionedIds = new Set(findAssetMentions(prompt, assets).map(({ asset }) => asset.id))
  const available = assets.filter((asset) => groups.some((group) => group.kinds.includes(asset.kind)))
  const visible = available.filter((asset) => relevantIds.has(asset.id))
  return (
    <section className="shot-prompt-assets" aria-label="本镜头资产">
      <header>
        <div>
          <strong>本镜头资产</strong>
          <small>点击名称，写入光标位置</small>
        </div>
      </header>
      {groups.map(({ label, kinds, Icon }) => {
        const entries = visible.filter((asset) => kinds.includes(asset.kind))
        if (!entries.length) return null
        return (
          <div className="shot-prompt-asset-group" key={label}>
            <span>
              <Icon size={14} />
              {label}
            </span>
            <div>
              {entries.flatMap((asset) => {
                const variants = asset.kind === 'character' ? asset.attributes?.appearanceVariants || [] : []
                return (variants.length ? variants : [null]).map((variant) => {
                  const name = variant ? characterVariantName(asset.name, variant.name) : asset.name
                  const preview = variant
                    ? variant.bodyReference?.url || asset.attributes.faceReference?.url
                    : getAssetPreviewUrl(asset, tasks)
                  const mentioned = variant
                    ? prompt.includes(name) || prompt.includes(variant.name)
                    : mentionedIds.has(asset.id)
                  return (
                    <button
                      key={`${asset.id}:${variant?.id || ''}`}
                      type="button"
                      className={mentioned ? 'mentioned' : ''}
                      disabled={disabled}
                      aria-label={`插入${label} ${name}`}
                      title={`${name} · ${preview ? '已有参考图' : '剧本资料已关联，图片待设计'}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onInsert(name)}
                    >
                      {preview ? <img src={preview} alt="" loading="lazy" /> : <Icon size={16} />}
                      <span>{name}</span>
                      {!preview && <small>待设计</small>}
                      {mentioned && <Check size={13} />}
                    </button>
                  )
                })
              })}
            </div>
          </div>
        )
      })}
      <div className="shot-prompt-asset-group shot-prompt-reference-group">
        <span>
          <Images size={14} />
          参考图
        </span>
        <div>
          {referenceImages.length ? (
            referenceImages.map((image, index) => {
              const mentioned = prompt.includes(`【图${index + 1}】`)
              return (
                <button
                  key={image.url}
                  type="button"
                  disabled={disabled}
                  title={image.name || `图${index + 1}`}
                  className={`reference-added ${mentioned ? 'mentioned' : ''}`.trim()}
                  aria-label={`插入参考图 图${index + 1}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onInsert(`【图${index + 1}】`)}
                >
                  <img src={image.url} alt="" />
                  <span>图{index + 1}</span>
                  {mentioned && (
                    <>
                      <Check size={13} />
                      <small>已引用</small>
                    </>
                  )}
                </button>
              )
            })
          ) : (
            <small>上传图片后，可点击编号写入提示词</small>
          )}
        </div>
      </div>
      {!visible.length && <p>本镜头尚未引用人物、物品或场景，可在下方使用资产库资产。</p>}
    </section>
  )
}
