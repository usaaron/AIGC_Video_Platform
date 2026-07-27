import { LoaderCircle, MapPinned, Package, Plus, RefreshCcw, Shirt, Sparkles, UserRound } from 'lucide-react'
import { optionLabel } from '../assets/assetOptions'

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
  onInspect,
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
                            <div className="script-asset-suggestion-facts">
                              {buildSuggestionFacts(asset).map((fact) => (
                                <span key={`${key}-${fact.label}`}>
                                  <b>{fact.label}</b>
                                  <em>{fact.value}</em>
                                </span>
                              ))}
                            </div>
                            <p>{asset.description}</p>
                            {asset.prompt && (
                              <div className="script-asset-suggestion-prompt">
                                <strong>提示词</strong>
                                <span>{asset.prompt}</span>
                              </div>
                            )}
                            <small>{asset.reason}</small>
                            <button
                              type="button"
                              className="button secondary"
                              disabled={disabled || isCreated || (!onInspect && isCreating)}
                              onClick={() => {
                                if (onInspect) {
                                  onInspect(asset)
                                  return
                                }
                                void onCreate(asset)
                              }}
                            >
                              {onInspect ? (
                                isCreated ? (
                                  <Sparkles size={14} />
                                ) : (
                                  <Plus size={14} />
                                )
                              ) : isCreating ? (
                                <LoaderCircle size={14} className="spin" />
                              ) : isCreated ? (
                                <Sparkles size={14} />
                              ) : (
                                <Plus size={14} />
                              )}
                              {onInspect
                                ? isCreated
                                  ? '已审阅并保存'
                                  : '先审阅写入'
                                : isCreating
                                  ? '正在加入'
                                  : isCreated
                                    ? '已加入资产库'
                                    : '加入资产库'}
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

function buildSuggestionFacts(asset) {
  const attributes = asset.attributes || {}
  if (asset.kind === 'character') {
    if (attributes.subjectType === 'animal') {
      return [
        { label: '类型', value: '动物角色' },
        { label: '物种', value: attributes.species || asset.name || '未指定' },
        { label: '形态', value: attributes.anthropomorphic ? '拟人化' : '自然动物' },
        { label: '身份', value: asset.description || asset.reason || '未补充' },
      ]
    }
    return [
      {
        label: '性别',
        value: optionLabel('gender', attributes.gender || 'unspecified'),
      },
      { label: '年龄段', value: optionLabel('ageGroup', attributes.ageGroup || 'young') },
      { label: '精确年龄', value: attributes.exactAge ? String(attributes.exactAge) : '未指定' },
      { label: '身份', value: asset.description || asset.reason || '未补充' },
    ]
  }
  if (asset.kind === 'scene') {
    return [
      { label: '空间', value: attributes.space ? optionLabel('space', attributes.space) : '未指定' },
      {
        label: '场景',
        value: attributes.sceneType ? optionLabel('sceneType', attributes.sceneType) : '未指定',
      },
      { label: '氛围', value: attributes.mood ? optionLabel('mood', attributes.mood) : '未指定' },
      { label: '运镜', value: attributes.camera ? optionLabel('camera', attributes.camera) : '未指定' },
    ]
  }
  if (asset.kind === 'prop') {
    return [
      {
        label: '分类',
        value: attributes.category ? optionLabel('propCategory', attributes.category) : '未指定',
      },
      { label: '材质', value: attributes.material ? optionLabel('material', attributes.material) : '未指定' },
      { label: '视角', value: attributes.view ? optionLabel('view', attributes.view) : '未指定' },
      {
        label: '状态',
        value: attributes.condition ? optionLabel('condition', attributes.condition) : '未指定',
      },
    ]
  }
  if (asset.kind === 'costume') {
    return [
      { label: '对象', value: attributes.audience ? optionLabel('audience', attributes.audience) : '未指定' },
      {
        label: '类型',
        value: attributes.category ? optionLabel('costumeCategory', attributes.category) : '未指定',
      },
      { label: '季节', value: attributes.season ? optionLabel('season', attributes.season) : '未指定' },
      { label: '风格', value: attributes.design ? optionLabel('design', attributes.design) : '未指定' },
    ]
  }
  if (asset.kind === 'audio') {
    return [
      {
        label: '类型',
        value: attributes.audioType ? optionLabel('audioType', attributes.audioType) : '未指定',
      },
      { label: '情绪', value: attributes.emotion ? optionLabel('emotion', attributes.emotion) : '未指定' },
      { label: '音色', value: attributes.tone ? optionLabel('tone', attributes.tone) : '未指定' },
      { label: '时长', value: attributes.duration ? `${attributes.duration} 秒` : '未指定' },
    ]
  }
  return []
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
