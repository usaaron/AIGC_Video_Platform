import { useEffect, useState } from 'react'
import {
  ArrowRight,
  CheckSquare2,
  LoaderCircle,
  Badge,
  ListChecks,
  MapPinned,
  Package,
  Pencil,
  Plus,
  RefreshCcw,
  Shirt,
  Sparkles,
  Square,
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
  onCancel,
  onFastExtract,
  onSkip,
  onCreate,
  onCreateAndGenerate,
  onImportSelected,
  onInspect,
  importing = false,
  stopping = false,
  disabled = false,
  copy = {},
}) {
  const assets = result?.assets || []
  const grouped = groupAssets(assets)
  const [editingKeys, setEditingKeys] = useState(() => new Set())
  const [editedPrompts, setEditedPrompts] = useState({})
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [importingSelected, setImportingSelected] = useState(false)
  const isSuggesting = status === 'suggesting'
  const isExtracting = status === 'extracting'
  const isBusy = isSuggesting || isExtracting
  const importBusy = importing || importingSelected
  const hasResult = Boolean(result)
  const creating = creatingKeys || new Set()
  const created = createdKeys || new Set()
  const selectedAssets = assets.filter((asset) => selectedKeys.has(assetSuggestionKey(asset)))
  const labels = {
    eyebrow: '资产建议',
    title: '从剧本提取人物、场景、物品、服装和品牌',
    refresh: hasResult ? '重新分析当前剧本' : '后台生成资产建议',
    loading: '模型正在后台分析资产；你可以停止、切换为快速提取，或直接进入资产设计。',
    empty: '提交后会在后台分析剧本，即使离开当前页面也会继续生成。',
    ...copy,
  }

  useEffect(() => {
    setSelectedKeys(
      new Set(
        assets
          .filter((asset) => !created.has(assetSuggestionKey(asset)))
          .map((asset) => assetSuggestionKey(asset)),
      ),
    )
  }, [result, createdKeys])

  const toggleSelected = (key) => {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleGroup = (items) => {
    const keys = items.map(assetSuggestionKey)
    const allSelected = keys.length > 0 && keys.every((key) => selectedKeys.has(key))
    setSelectedKeys((current) => {
      const next = new Set(current)
      keys.forEach((key) => (allSelected ? next.delete(key) : next.add(key)))
      return next
    })
  }

  const importSelected = async () => {
    if (!onImportSelected || !selectedAssets.length) return
    const inputs = selectedAssets.map((asset) => ({
      ...asset,
      prompt: editedPrompts[assetSuggestionKey(asset)] ?? asset.prompt ?? '',
    }))
    setImportingSelected(true)
    try {
      await onImportSelected(inputs)
      setSelectedKeys(new Set())
    } finally {
      setImportingSelected(false)
    }
  }

  return (
    <section className="script-asset-suggestions" aria-busy={isBusy}>
      <div className="script-asset-suggestions-head">
        <div>
          <span className="eyebrow">{labels.eyebrow}</span>
          <h2>{labels.title}</h2>
        </div>
        <div className="script-asset-suggestions-head-actions">
          {onImportSelected && hasResult && (
            <button
              className="button primary"
              type="button"
              disabled={disabled || importBusy || !selectedAssets.length}
              onClick={() => void importSelected()}
            >
              {importBusy ? <LoaderCircle size={15} className="spin" /> : <ListChecks size={15} />}
              {importBusy
                ? '正在导入'
                : `一键导入资产${selectedAssets.length ? `（${selectedAssets.length}）` : ''}`}
            </button>
          )}
          {isSuggesting ? (
            <>
              <button
                className="button secondary"
                type="button"
                disabled={disabled || stopping}
                onClick={onCancel}
              >
                {stopping ? <LoaderCircle size={15} className="spin" /> : <Square size={14} />}
                {stopping ? '正在停止' : '停止资产分析'}
              </button>
              <button
                className="button primary"
                type="button"
                disabled={disabled || stopping}
                onClick={onFastExtract}
              >
                <ListChecks size={15} />
                使用剧本快速提取
              </button>
            </>
          ) : (
            <button
              className="button secondary"
              type="button"
              disabled={disabled || isExtracting}
              onClick={onRefresh}
            >
              {isExtracting ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />}
              {isExtracting ? '正在快速提取' : labels.refresh}
            </button>
          )}
        </div>
      </div>

      {isBusy && (
        <div className="script-asset-suggestions-loading" role="status">
          <LoaderCircle size={19} className="spin" />
          <span>{isExtracting ? '正在从剧本结构中快速提取人物、场景和关键物件。' : labels.loading}</span>
          {isSuggesting && onSkip && (
            <button className="button ghost" type="button" disabled={stopping} onClick={onSkip}>
              跳过并进入资产设计
              <ArrowRight size={14} />
            </button>
          )}
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
              const selectableItems = items.filter((asset) => !created.has(assetSuggestionKey(asset)))
              return (
                <section className="script-asset-suggestion-group" key={kind}>
                  <div className="script-asset-suggestion-group-head">
                    <Icon size={16} />
                    <strong>{meta.label}</strong>
                    <span>{items.length}</span>
                    {selectableItems.length > 0 && (
                      <button
                        type="button"
                        className="script-asset-suggestion-select-group"
                        disabled={disabled || importBusy}
                        onClick={() => toggleGroup(selectableItems)}
                      >
                        {selectableItems.every((asset) => selectedKeys.has(assetSuggestionKey(asset))) ? (
                          <CheckSquare2 size={13} />
                        ) : (
                          <Square size={13} />
                        )}
                        全选
                      </button>
                    )}
                  </div>
                  {items.length ? (
                    <div className="script-asset-suggestion-list">
                      {items.map((asset) => {
                        const key = assetSuggestionKey(asset)
                        const isCreating = creating.has(key)
                        const isCreated = created.has(key)
                        const isEditing = editingKeys.has(key)
                        const isSelected = selectedKeys.has(key)
                        const promptValue = editedPrompts[key] ?? asset.prompt ?? ''
                        return (
                          <article className="script-asset-suggestion-card" key={key}>
                            <div className="script-asset-suggestion-card-top">
                              <label className="script-asset-suggestion-check">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  disabled={disabled || importBusy || isCreated}
                                  onChange={() => toggleSelected(key)}
                                  aria-label={`选择${asset.name}导入资产`}
                                />
                                {isSelected ? <CheckSquare2 size={16} /> : <Square size={16} />}
                                <strong>{asset.name}</strong>
                              </label>
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
                                onClick={() => onInspect?.({ ...asset, prompt: promptValue })}
                              >
                                <Pencil size={14} />
                                打开生成框
                              </button>
                              {(onCreateAndGenerate || onCreate) && (
                                <button
                                  type="button"
                                  className="button primary"
                                  disabled={disabled || isCreated || isCreating}
                                  onClick={() => {
                                    const nextAsset = { ...asset, prompt: promptValue }
                                    if (onCreateAndGenerate) void onCreateAndGenerate(nextAsset)
                                    else void onCreate(nextAsset)
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
                                        ? '确认生成'
                                        : '加入资产设计'}
                                </button>
                              )}
                              <button
                                type="button"
                                className="button ghost script-asset-suggestion-inline-edit"
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
                                <Pencil size={13} />
                                {isEditing ? '收起提示词编辑' : '快速编辑提示词'}
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

      {!hasResult && !isBusy && !error && <p className="script-asset-suggestion-empty">{labels.empty}</p>}
    </section>
  )
}

export function assetSuggestionKey(asset) {
  return `${asset.kind}:${asset.name.trim().toLocaleLowerCase('zh-CN')}`
}

function buildSuggestionFacts(asset) {
  const attributes = asset.attributes || {}
  const sourceFacts = asset.sourceFacts || {}
  const sourceFact = (...labels) => labels.map((label) => sourceFacts[label]).find(Boolean) || ''
  const sourceFactList = (...labels) =>
    labels
      .map((label) => sourceFacts[label])
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join('、')
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
      { label: '精确年龄', value: attributes.exactAge ? `${attributes.exactAge} 岁` : '未指定' },
      { label: '身份', value: sourceFact('身份', '角色身份', '人物背景') || asset.description || '未补充' },
      { label: '固定外形', value: sourceFact('固定外形', '外形', '外貌', '基础造型') || '未补充' },
      { label: '体貌', value: sourceFactList('体型', '脸型', '肤色') || '未补充' },
      { label: '发型', value: sourceFactList('发型', '发色') || '未补充' },
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
      { label: '时代', value: sourceFact('时代', '年代') || optionLabel('era', attributes.era) || '未指定' },
      { label: '用途', value: sourceFact('场景用途', '用途') || '未补充' },
      {
        label: '固定布局',
        value: sourceFactList('固定布局', '空间布局', '布局', '入口出口', '固定陈设') || '未补充',
      },
      { label: '材质色彩', value: sourceFactList('材质', '基础色彩', '基础氛围') || '未补充' },
    ]
  }
  if (asset.kind === 'prop') {
    return [
      {
        label: '分类',
        value: attributes.category ? optionLabel('propCategory', attributes.category) : '未指定',
      },
      { label: '材质', value: attributes.material ? optionLabel('material', attributes.material) : '未指定' },
      { label: '颜色', value: sourceFact('颜色', '配色') || '未指定' },
      {
        label: '状态',
        value:
          sourceFact('基础状态', '基准状态') ||
          (attributes.condition ? optionLabel('condition', attributes.condition) : '未指定'),
      },
      { label: '固定结构', value: sourceFactList('尺度', '形状', '固定结构', '结构') || '未补充' },
      { label: '归属', value: sourceFact('归属', '持有人', '所有者') || '未指定' },
      { label: '准确文字', value: sourceFact('准确文字', '文字') || '无' },
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
      { label: '归属', value: sourceFact('归属', '角色', '穿着者') || '未指定' },
      { label: '剪裁层次', value: sourceFactList('剪裁', '层次', '款式') || '未补充' },
      { label: '颜色材质', value: sourceFactList('颜色', '配色', '材质') || '未补充' },
      { label: '配件', value: sourceFact('配件', '饰品') || '无' },
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
      { label: '标准色', value: sourceFact('标准色', '配色', '颜色') || attributes.palette || '未指定' },
      {
        label: '背景',
        value:
          sourceFact('版式背景', '背景') ||
          (attributes.background ? optionLabel('background', attributes.background) : '透明'),
      },
      { label: '图形结构', value: sourceFactList('图形结构', '版式', '字体方向') || '未补充' },
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
