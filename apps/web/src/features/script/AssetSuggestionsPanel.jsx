import { LoaderCircle, MapPinned, Package, Plus, RefreshCcw, Shirt, Sparkles, UserRound } from 'lucide-react'

const KIND_META = {
  character: { label: '角色', icon: UserRound },
  scene: { label: '场景', icon: MapPinned },
  prop: { label: '道具', icon: Package },
  costume: { label: '服装', icon: Shirt },
}

const KIND_ORDER = ['character', 'scene', 'prop', 'costume']

export function AssetSuggestionsPanel({
  status,
  result,
  error,
  creatingKeys,
  createdKeys,
  onRefresh,
  onCreate,
  disabled = false,
  copy = {},
}) {
  const assets = result?.assets || []
  const grouped = groupAssets(assets)
  const isSuggesting = status === 'suggesting'
  const hasResult = Boolean(result)
  const labels = {
    eyebrow: '资产建议',
    title: '从剧本提取角色、场景、道具、服装',
    refresh: hasResult ? '重新分析当前剧本' : '生成资产建议',
    loading: '正在分析剧本中的核心资产',
    empty: '生成或应用剧本后会自动分析，也可以手动从当前文本重新生成建议。',
    ...copy,
  }

  return (
    <section className="script-asset-suggestions" aria-busy={isSuggesting}>
      <div className="script-asset-suggestions-head">
        <div>
          <span className="eyebrow">{labels.eyebrow}</span>
          <h2>{labels.title}</h2>
        </div>
        <button
          className="button secondary"
          type="button"
          disabled={disabled || isSuggesting}
          onClick={onRefresh}
        >
          {isSuggesting ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />}
          {labels.refresh}
        </button>
      </div>

      {isSuggesting && (
        <div className="script-asset-suggestions-loading" role="status">
          <LoaderCircle size={19} className="spin" />
          <span>{labels.loading}</span>
        </div>
      )}

      {error && (
        <p className="script-asset-suggestions-error" role="alert">
          {error}
        </p>
      )}

      {result?.warnings?.length > 0 && (
        <div className="script-asset-suggestions-warning" role="status">
          {result.warnings.slice(0, 2).join('；')}
        </div>
      )}

      {hasResult && (
        <>
          <p className="script-asset-suggestions-summary">{result.summary}</p>
          <div className="script-asset-suggestion-sections">
            {KIND_ORDER.map((kind) => {
              const meta = KIND_META[kind]
              const Icon = meta.icon
              const items = grouped[kind] || []
              return (
                <section className="script-asset-suggestion-group" key={kind}>
                  <div className="script-asset-suggestion-group-head">
                    <Icon size={16} />
                    <strong>{meta.label}</strong>
                    <span>{items.length}</span>
                  </div>
                  {items.length ? (
                    <div className="script-asset-suggestion-list">
                      {items.map((asset) => {
                        const key = assetSuggestionKey(asset)
                        const isCreating = creatingKeys.has(key)
                        const isCreated = createdKeys.has(key)
                        return (
                          <article className="script-asset-suggestion-card" key={key}>
                            <div className="script-asset-suggestion-card-top">
                              <strong>{asset.name}</strong>
                              <span>优先级 {asset.priority}</span>
                            </div>
                            <p>{asset.description}</p>
                            <small>{asset.reason}</small>
                            <button
                              type="button"
                              className="button secondary"
                              disabled={disabled || isCreating || isCreated}
                              onClick={() => void onCreate(asset)}
                            >
                              {isCreating ? (
                                <LoaderCircle size={14} className="spin" />
                              ) : isCreated ? (
                                <Sparkles size={14} />
                              ) : (
                                <Plus size={14} />
                              )}
                              {isCreating ? '正在加入' : isCreated ? '已加入资产库' : '加入资产库'}
                            </button>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="script-asset-suggestion-empty">暂无需要单独创建的{meta.label}资产</p>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}

      {!hasResult && !isSuggesting && !error && (
        <p className="script-asset-suggestion-empty">{labels.empty}</p>
      )}
    </section>
  )
}

export function assetSuggestionKey(asset) {
  return `${asset.kind}:${asset.name.trim().toLocaleLowerCase('zh-CN')}`
}

function groupAssets(assets) {
  return assets.reduce(
    (groups, asset) => ({
      ...groups,
      [asset.kind]: [...groups[asset.kind], asset],
    }),
    { character: [], scene: [], prop: [], costume: [] },
  )
}
