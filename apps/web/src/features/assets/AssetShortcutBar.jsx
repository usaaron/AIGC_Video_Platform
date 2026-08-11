import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Badge,
  ChevronDown,
  Image,
  Link2,
  LoaderCircle,
  MapPinned,
  Package,
  Shirt,
  Users,
} from 'lucide-react'

const KIND_LABELS = {
  character: '人物',
  scene: '场景',
  prop: '物品',
  costume: '服装',
  brand: '品牌 / Logo',
}

const KIND_ICONS = {
  character: Users,
  scene: MapPinned,
  prop: Package,
  costume: Shirt,
  brand: Badge,
}

const KIND_ORDER = ['character', 'scene', 'prop', 'costume', 'brand']

export function AssetShortcutBar({
  assets = [],
  tasks = [],
  value = '',
  onChange,
  inputRef,
  label = '资产引用',
  placement = 'bottom',
}) {
  const availableAssets = assets.filter((asset) => KIND_ORDER.includes(asset.kind))
  if (!availableAssets.length) return null
  const mentions = findAssetMentions(value, availableAssets)
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    assets: availableAssets.filter((asset) => asset.kind === kind),
  })).filter((group) => group.assets.length)

  const insert = (asset) => {
    const target = inputRef?.current
    const source = String(value || '')
    const start = typeof target?.selectionStart === 'number' ? target.selectionStart : source.length
    const end = typeof target?.selectionEnd === 'number' ? target.selectionEnd : start
    const before = source.slice(0, start)
    const after = source.slice(end)
    const prefix = before && !/[\s，。；：:|]/u.test(before.slice(-1)) ? '；' : ''
    const nextValue = `${before}${prefix}${asset.name}${after}`
    const editorScroll = target ? { left: target.scrollLeft, top: target.scrollTop } : null
    const pageScroll = { left: window.scrollX, top: window.scrollY }
    onChange?.(nextValue)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!target) return
        const cursor = start + prefix.length + asset.name.length
        target.focus({ preventScroll: true })
        target.setSelectionRange(cursor, cursor)
        if (editorScroll) {
          target.scrollLeft = editorScroll.left
          target.scrollTop = editorScroll.top
        }
        window.scrollTo(pageScroll.left, pageScroll.top)
      })
    })
  }

  return (
    <details className={`asset-shortcut-bar placement-${placement}`}>
      <summary className="asset-shortcut-heading">
        <span className="asset-shortcut-heading-icon">
          <Link2 size={14} />
        </span>
        <span>
          <strong>{label}</strong>
          <small>
            {mentions.length ? `正文已引用 ${mentions.length} 项` : `${availableAssets.length} 项可插入`}
          </small>
        </span>
        <span className="asset-shortcut-kind-dots" aria-hidden="true">
          {groups.map((group) => (
            <i className={`kind-${group.kind}`} key={group.kind} />
          ))}
        </span>
        <ChevronDown className="asset-shortcut-chevron" size={14} />
      </summary>

      <div className="asset-shortcut-popover">
        <header>
          <div>
            <strong>插入项目资产</strong>
            <small>选择分类，再点击名称插入当前光标位置</small>
          </div>
          <span>{availableAssets.length} 项</span>
        </header>
        <div className="asset-shortcut-groups">
          {groups.map((group) => {
            const KindIcon = KIND_ICONS[group.kind]
            const usedCount = group.assets.filter((asset) =>
              mentions.some((mention) => mention.asset.id === asset.id),
            ).length
            return (
              <details className={`asset-shortcut-group kind-${group.kind}`} key={group.kind}>
                <summary>
                  <KindIcon size={14} />
                  <strong>{KIND_LABELS[group.kind]}</strong>
                  <span>{usedCount ? `${usedCount} 已引用` : `${group.assets.length} 项`}</span>
                  <ChevronDown size={13} />
                </summary>
                <div className="asset-shortcut-list">
                  {group.assets.map((asset) => {
                    const state = assetState(asset, tasks)
                    const previewUrl = assetPreviewUrl(asset, tasks)
                    const inText = mentions.some((mention) => mention.asset.id === asset.id)
                    return (
                      <button
                        className={`asset-shortcut-button kind-${asset.kind} ${state} ${inText ? 'in-text' : ''}`}
                        type="button"
                        key={asset.id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insert(asset)}
                        title={`${KIND_LABELS[asset.kind]}：${asset.name}`}
                      >
                        {previewUrl ? (
                          <img src={previewUrl} alt="" />
                        ) : state === 'failed' ? (
                          <AlertCircle size={13} />
                        ) : state === 'pending' ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : (
                          <Image size={13} />
                        )}
                        <span>{asset.name}</span>
                        <small>{state === 'ready' ? '可用' : state === 'failed' ? '失败' : '待生成'}</small>
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
              </details>
            )
          })}
        </div>
      </div>
    </details>
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
  const editorRef = useRef(null)
  const measureFrameRef = useRef(null)
  const [scrollPosition, setScrollPosition] = useState({ left: 0, top: 0 })
  const [editorMetrics, setEditorMetrics] = useState(null)
  const availableAssets = assets.filter((asset) => KIND_ORDER.includes(asset.kind))
  const mentions = findAssetMentions(value, availableAssets)

  const assignRef = (node) => {
    editorRef.current = node
    if (typeof inputRef === 'function') inputRef(node)
    else if (inputRef) inputRef.current = node
  }

  const measureEditor = () => {
    const target = editorRef.current
    if (!target || !target.clientWidth) return
    const computed = window.getComputedStyle(target)
    const nextMetrics = {
      width: target.clientWidth,
      left: Number.parseFloat(computed.borderLeftWidth) || 0,
      top: Number.parseFloat(computed.borderTopWidth) || 0,
      padding: computed.padding,
      boxSizing: computed.boxSizing,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontStyle: computed.fontStyle,
      fontWeight: computed.fontWeight,
      letterSpacing: computed.letterSpacing,
      lineHeight: computed.lineHeight,
      overflowWrap: computed.overflowWrap,
      tabSize: computed.tabSize,
      textAlign: computed.textAlign,
      textIndent: computed.textIndent,
      textTransform: computed.textTransform,
      whiteSpace: computed.whiteSpace,
      wordBreak: computed.wordBreak,
      wordSpacing: computed.wordSpacing,
    }
    setEditorMetrics((current) => (sameEditorMetrics(current, nextMetrics) ? current : nextMetrics))
  }

  const syncEditorLayout = () => {
    const target = editorRef.current
    if (!target) return
    setScrollPosition((current) => {
      const next = { left: target.scrollLeft, top: target.scrollTop }
      return current.left === next.left && current.top === next.top ? current : next
    })
    measureEditor()
  }

  const scheduleEditorLayoutSync = () => {
    if (measureFrameRef.current !== null) window.cancelAnimationFrame(measureFrameRef.current)
    measureFrameRef.current = window.requestAnimationFrame(() => {
      syncEditorLayout()
      measureFrameRef.current = window.requestAnimationFrame(() => {
        measureFrameRef.current = null
        syncEditorLayout()
      })
    })
  }

  useEffect(() => {
    const target = editorRef.current
    if (!target) return undefined
    scheduleEditorLayoutSync()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(scheduleEditorLayoutSync)
    observer.observe(target)
    return () => {
      observer.disconnect()
      if (measureFrameRef.current !== null) window.cancelAnimationFrame(measureFrameRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    scheduleEditorLayoutSync()
  }, [value])

  const handleChange = (event) => {
    onChange?.(event)
    scheduleEditorLayoutSync()
  }

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
          style={{
            transform: `translate(${(editorMetrics?.left || 0) - scrollPosition.left}px, ${(editorMetrics?.top || 0) - scrollPosition.top}px)`,
            ...(editorMetrics
              ? {
                  width: `${editorMetrics.width}px`,
                  minWidth: `${editorMetrics.width}px`,
                  padding: editorMetrics.padding,
                  boxSizing: editorMetrics.boxSizing,
                  fontFamily: editorMetrics.fontFamily,
                  fontSize: editorMetrics.fontSize,
                  fontStyle: editorMetrics.fontStyle,
                  fontWeight: editorMetrics.fontWeight,
                  letterSpacing: editorMetrics.letterSpacing,
                  lineHeight: editorMetrics.lineHeight,
                  overflowWrap: editorMetrics.overflowWrap,
                  tabSize: editorMetrics.tabSize,
                  textAlign: editorMetrics.textAlign,
                  textIndent: editorMetrics.textIndent,
                  textTransform: editorMetrics.textTransform,
                  whiteSpace: editorMetrics.whiteSpace,
                  wordBreak: editorMetrics.wordBreak,
                  wordSpacing: editorMetrics.wordSpacing,
                }
              : {}),
          }}
        >
          {renderHighlightedText(value, mentions, tasks)}
        </div>
      </div>
      <textarea
        {...textareaProps}
        ref={assignRef}
        value={value}
        onChange={handleChange}
        onScroll={handleScroll}
        className={textareaProps.className}
        style={style}
      />
    </div>
  )
}

function sameEditorMetrics(current, next) {
  if (!current) return false
  return Object.keys(next).every((key) => current[key] === next[key])
}

function renderHighlightedText(value, mentions, tasks) {
  if (!value) return '\u00a0'
  if (!mentions.length) return value
  const nodes = []
  let cursor = 0
  mentions.forEach((mention, index) => {
    if (mention.start > cursor) nodes.push(value.slice(cursor, mention.start))
    const state = assetState(mention.asset, tasks)
    nodes.push(
      <span
        key={`${mention.asset.id}-${mention.start}-${index}`}
        className={`asset-inline-mention kind-${mention.asset.kind} ${state}`}
      >
        {mention.text}
      </span>,
    )
    cursor = mention.end
  })
  if (cursor < value.length) nodes.push(value.slice(cursor))
  return nodes
}

export function findAssetMentions(value, assets) {
  const names = [
    ...new Set(assets.map((asset) => asset.name?.trim()).filter((name) => name && name.length > 1)),
  ].sort((left, right) => right.length - left.length)
  if (!String(value || '').trim() || !names.length) return []
  const matcher = new RegExp(names.map(escapeRegExp).join('|'), 'gu')
  return [...String(value).matchAll(matcher)]
    .map((match) => {
      const start = match.index || 0
      const text = match[0]
      const asset = assets.find((candidate) => candidate.name?.trim() === text)
      return asset ? { asset, text, start, end: start + text.length } : null
    })
    .filter(Boolean)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function assetState(asset, tasks) {
  const related = tasks
    .filter((task) => task.metadata?.assetId === asset.id && task.kind === 'image')
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt || right.createdAt || '') -
        Date.parse(left.updatedAt || left.createdAt || ''),
    )
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
    .filter(
      (task) => task.metadata?.assetId === asset.id && task.status === 'completed' && task.outputs?.length,
    )
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt || right.createdAt || '') -
        Date.parse(left.updatedAt || left.createdAt || ''),
    )[0]?.outputs?.[0]
}
