import { Check, Package, MapPinned, Users } from 'lucide-react'
import { findAssetMentions } from '../assets/AssetShortcutBar'
import { getAssetPreviewUrl } from '../assets/assetPreview'

const groups = [
  { label: '人物', kinds: ['character'], Icon: Users },
  { label: '物品', kinds: ['prop', 'costume', 'brand'], Icon: Package },
  { label: '场景', kinds: ['scene'], Icon: MapPinned },
]

export function ShotAssetShortcuts({ shot, assets, tasks, prompt, onInsert, disabled }) {
  const relevantIds = new Set(
    findAssetMentions(`${shot.title || ''}\n${shot.prompt || ''}\n${prompt}`, assets).map(
      ({ asset }) => asset.id,
    ),
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
              {entries.map((asset) => {
                const preview = getAssetPreviewUrl(asset, tasks)
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={mentionedIds.has(asset.id) ? 'mentioned' : ''}
                    disabled={disabled}
                    aria-label={`插入${label} ${asset.name}`}
                    title={`${asset.name} · ${preview ? '已有参考图' : '可插入名称，图片待生成'}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onInsert(asset.name)}
                  >
                    {preview ? <img src={preview} alt="" loading="lazy" /> : <Icon size={16} />}
                    <span>{asset.name}</span>
                    {mentionedIds.has(asset.id) && <Check size={13} />}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {!visible.length && <p>本镜头尚未引用人物、物品或场景，可在下方使用资产库资产。</p>}
    </section>
  )
}
