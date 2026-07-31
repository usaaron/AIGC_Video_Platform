import { useState } from 'react'
import { AlertCircle, Image, LoaderCircle } from 'lucide-react'

const KIND_LABELS = {
  character: '人物',
  scene: '场景',
  prop: '物品',
  costume: '服装',
}

export function AssetShortcutBar({ assets = [], tasks = [], value = '', onChange, inputRef, label = '资产快捷键' }) {
  const availableAssets = assets.filter((asset) => asset.kind !== 'audio')
  if (!availableAssets.length) return null
  const mentions = findAssetMentions(value, availableAssets)

  const insert = (asset) => {
    const target = inputRef?.current
    const source = String(value || '')
    const start = typeof target?.selectionStart === 'number' ? target.selectionStart : source.length
    const end = typeof target?.selectionEnd === 'number' ? target.selectionEnd : start
    const before = source.slice(0, start)
    const after = source.slice(end)
    const prefix = before && !/[\s，。；：:|]/u.test(before.slice(-1)) ? '；' : ''
    const nextValue = `${before}${prefix}${asset.name}${after}`
    onChange?.(nextValue)
    requestAnimationFrame(() => {
      if (!target) return
      const cursor = start + prefix.length + asset.name.length
      target.focus()
      target.setSelectionRange(cursor, cursor)
    })
  }

  return (
    <div className="asset-shortcut-bar" aria-label={label}>
      <div className="asset-shortcut-heading">
        <span>{label}</span>
        <small>
          {mentions.length > 0 ? `已识别 ${mentions.length} 个资产` : '点击名称插入当前光标位置'}
        </small>
      </div>
      <div className="asset-shortcut-list">
        {availableAssets.map((asset) => {
          const state = assetState(asset, tasks)
          const previewUrl = assetPreviewUrl(asset, tasks)
          const inText = mentions.some((mention) => mention.asset.id === asset.id)
          return (
            <button
              className={`asset-shortcut-button ${state} ${inText ? 'in-text' : ''}`}
              type="button"
              key={asset.id}
              onClick={() => insert(asset)}
              title={`${KIND_LABELS[asset.kind] || '资产'}：${asset.name}`}
            >
              {previewUrl ? <img src={previewUrl} alt="" /> : state === 'failed' ? <AlertCircle size={13} /> : state === 'pending' ? <LoaderCircle size={13} className="spin" /> : <Image size={13} />}
              <span>{asset.name}</span>
              <small>{state === 'ready' ? KIND_LABELS[asset.kind] || '资产' : state === 'failed' ? '生成失败' : '待生成'}</small>
              {previewUrl && (
                <span className="asset-shortcut-hover-preview" aria-hidden="true">
                  <img src={previewUrl} alt="" />
                  <b>{asset.name}</b>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function AssetAwareTextarea({
  assets = [],
  tasks = [],
  value = '',
  onChange,
  inputRef,
  className = '',
  style,
  onScroll,
  ...textareaProps
}) {
  const [scrollPosition, setScrollPosition] = useState({ left: 0, top: 0 })
  const availableAssets = assets.filter((asset) => asset.kind !== 'audio')
  const mentions = findAssetMentions(value, availableAssets)

  const handleScroll = (event) => {
    const target = event.currentTarget
    setScrollPosition({ left: target.scrollLeft, top: target.scrollTop })
    onScroll?.(event)
  }

  return (
    <div className={`asset-aware-textarea ${className}`.trim()}>
      <div className="asset-aware-highlight" aria-hidden="true">
        <div
          className="asset-aware-highlight-inner"
          style={{ transform: `translate(${-scrollPosition.left}px, ${-scrollPosition.top}px)` }}
        >
          {renderHighlightedText(value, mentions, tasks, inputRef)}
        </div>
      </div>
      <textarea
        {...textareaProps}
        ref={inputRef}
        value={value}
        onChange={onChange}
        onScroll={handleScroll}
        className={textareaProps.className}
        style={style}
      />
    </div>
  )
}

function renderHighlightedText(value, mentions, tasks, inputRef) {
  if (!value) return '\u00a0'
  if (!mentions.length) return value
  const nodes = []
  let cursor = 0
  mentions.forEach((mention, index) => {
    if (mention.start > cursor) nodes.push(value.slice(cursor, mention.start))
    const state = assetState(mention.asset, tasks)
    nodes.push(
      <button
        type="button"
        key={`${mention.asset.id}-${mention.start}-${index}`}
        className={`asset-inline-mention ${state}`}
        title={`${KIND_LABELS[mention.asset.kind] || '资产'}：${mention.asset.name}（点击定位）`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const target = inputRef?.current
          if (!target) return
          target.focus()
          target.setSelectionRange(mention.start, mention.end)
        }}
      >
        {mention.text}
      </button>,
    )
    cursor = mention.end
  })
  if (cursor < value.length) nodes.push(value.slice(cursor))
  return nodes
}

function findAssetMentions(value, assets) {
  const names = [...new Set(assets.map((asset) => asset.name?.trim()).filter((name) => name && name.length > 1))]
    .sort((left, right) => right.length - left.length)
  if (!String(value || '').trim() || !names.length) return []
  const matcher = new RegExp(names.map(escapeRegExp).join('|'), 'gu')
  return [...String(value).matchAll(matcher)].map((match) => {
    const start = match.index || 0
    const text = match[0]
    const asset = assets.find((candidate) => candidate.name?.trim() === text)
    return asset ? { asset, text, start, end: start + text.length } : null
  }).filter(Boolean)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function assetState(asset, tasks) {
  const related = tasks
    .filter((task) => task.metadata?.assetId === asset.id && task.kind === 'image')
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || '') - Date.parse(left.updatedAt || left.createdAt || ''))
  if (related[0]?.status === 'failed') return 'failed'
  if (assetPreviewUrl(asset, tasks)) return 'ready'
  if (related.some((task) => ['queued', 'paused', 'running'].includes(task.status))) return 'pending'
  return 'pending'
}

function assetPreviewUrl(asset, tasks) {
  if (asset.kind === 'character') {
    const activeVariant = (asset.attributes?.appearanceVariants || []).find(
      (variant) => variant.id === asset.attributes?.activeAppearanceVariantId,
    )
    return (
      activeVariant?.bodyReference?.url ||
      asset.attributes?.bodyReference?.url ||
      asset.attributes?.faceReference?.url ||
      asset.imageUrl ||
      latestCompletedOutput(asset, tasks)?.url ||
      null
    )
  }
  return asset.imageUrl || latestCompletedOutput(asset, tasks)?.url || null
}

function latestCompletedOutput(asset, tasks) {
  return tasks
    .filter((task) => task.metadata?.assetId === asset.id && task.status === 'completed' && task.outputs?.length)
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || '') - Date.parse(left.updatedAt || left.createdAt || ''))[0]
    ?.outputs?.[0]
}
