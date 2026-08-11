import { useState } from 'react'
import {
  LoaderCircle,
  Badge,
  MapPinned,
  Package,
  Pencil,
  Plus,
  RefreshCcw,
  Shirt,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { optionLabel } from '../assets/assetOptions'

const KIND_META = {
  character: { label: '人物', icon: UserRound },
  scene: { label: '场景', icon: MapPinned },
  prop: { label: '物品', icon: Package },
  costume: { label: '服装', icon: Shirt },
  brand: { label: '品牌 / Logo', icon: Badge },
}

const KIND_ORDER = ['character', 'scene', 'prop', 'costume', 'brand']

export function AssetSuggestionsPanel({
  status,
  result,
  error,
  creatingKeys,
  createdKeys,
  onRefresh,
  onCreate,
  onCreateAndGenerate,
  onInspect,
  disabled = false,
  copy = {},
}) {
  const assets = result?.assets || []
  const grouped = groupAssets(assets)
  const [editingKeys, setEditingKeys] = useState(() => new Set())
  const [editedPrompts, setEditedPrompts] = useState({})
  const isSuggesting = status === 'suggesting'
  const hasResult = Boolean(result)
  const labels = {
    eyebrow: '资产建议',
    title: '从剧本提取人物、场景、物品、服装和品牌',
    refresh: hasResult ? '重新分析当前剧本' : '后台生成资产建议',
    loading: '资产建议正在后台生成，完成后会自动显示',
    empty: '提交后会在后台分析剧本，即使离开当前页面也会继续生成。',
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
                        const isEditing = editingKeys.has(key)
                        const promptValue = editedPrompts[key] ?? asset.prompt ?? ''
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
                            {isEditing && (
                              <label className="script-asset-suggestion-edit">
                                <span>写入前编辑提示词</span>
                                <textarea
                                  value={promptValue}
                                  rows={5}
                                  onChange={(event) =>
                                    setEditedPrompts((current) => ({ ...current, [key]: event.target.value }))
                                  }
                                  placeholder="补充这个资产的外观、材质、动作限制和生成要求"
                                />
                              </label>
                            )}
                            <small>{asset.reason}</small>
                            <div className="script-asset-suggestion-actions">
                              <button
                                type="button"
                                className="button secondary"
                                disabled={disabled || isCreated}
                                onClick={() =>
                                  setEditingKeys((current) => {
                                    const next = new Set(current)
                                    if (next.has(key)) next.delete(key)
                                    else next.add(key)
                                    return next
                                  })
                                }
                              >
                                <Pencil size={14} />
                                {isEditing ? '收起编辑' : '编辑提示词'}
                              </button>
                              <button
                                type="button"
                                className="button primary"
                                disabled={disabled || isCreated || isCreating}
                                onClick={() => {
                                  const nextAsset = { ...asset, prompt: promptValue }
                                  if (onCreateAndGenerate) {
                                    void onCreateAndGenerate(nextAsset)
                                  } else if (onInspect) {
                                    onInspect(nextAsset)
                                  } else if (onCreate) {
                                    void onCreate(nextAsset)
                                  }
                                }}
                              >
                                {isCreating ? (
                                  <LoaderCircle size={14} className="spin" />
                                ) : isCreated ? (
                                  <Sparkles size={14} />
                                ) : (
                                  <Plus size={14} />
                                )}
                                {isCreating
                                  ? '正在确认并生成'
                                  : isCreated
                                    ? '已确认并生成'
                                    : onCreateAndGenerate
                                      ? '确认并生成'
                                      : onInspect
                                        ? '先审阅后写入'
                                        : '加入资产库'}
                              </button>
                            </div>
                            {isEditing && (
                              <small className="script-asset-suggestion-edit-hint">
                                保存前仍可在资产编辑器中继续修改名称、属性和提示词。
                              </small>
                            )}
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
        { label: '类型', value: '动物' },
        { label: '物种', value: attributes.species || asset.name },
        { label: '形态', value: attributes.anthropomorphic ? '拟人化动物' : '自然动物' },
        { label: '用途', value: '面部与形象一致性资产' },
      ]
    }
    return [
      {
        label: '性别',
        value:
          attributes.subjectType === 'animal'
            ? '动物'
            : optionLabel('gender', attributes.gender || 'unspecified'),
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
  if (asset.kind === 'brand') {
    return [
      {
        label: '形态',
        value: attributes.brandType ? optionLabel('brandType', attributes.brandType) : '未指定',
      },
      { label: '用途', value: attributes.usage ? optionLabel('usage', attributes.usage) : '未指定' },
      { label: '文字', value: attributes.exactText || asset.name },
      {
        label: '背景',
        value: attributes.background ? optionLabel('background', attributes.background) : '透明',
      },
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
    { character: [], scene: [], prop: [], costume: [], brand: [] },
  )
}
