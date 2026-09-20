import { characterIdentity } from '@seqora/contracts'

const FIELD_KINDS = {
  角色: 'character',
  人物: 'character',
  场景: 'scene',
  关键物件: 'prop',
  物品: 'prop',
  道具: 'prop',
}
const EMPTY = /^(?:无|无人|无人物|无角色|无物品|无道具|未指定|none|null|n\/a)$/iu
const SCENE_PERIOD = /^(?:白天|日间|白昼|夜晚|夜间|清晨|黎明|黄昏|傍晚|日|夜|day|night|dawn|dusk)$/iu

// These are the production prompt's explicit appearance fields. Narrative
// mentions and quoted dialogue cannot add cast when a field is present.
export function shotAssetFields(prompt = '') {
  const fields = new Map()
  for (const match of String(prompt).matchAll(
    /(?:^|[\n｜|])\s*(角色|人物|场景|关键物件|物品|道具)\s*[：:]\s*([^\n｜|]*)/gu,
  )) {
    const kind = FIELD_KINDS[match[1]]
    const values = (kind === 'scene' ? [match[2]] : match[2].split(/[、,，;；]/u))
      .map((value) => value.trim())
      .filter((value) => value && !EMPTY.test(value))
    fields.set(kind, [...(fields.get(kind) || []), ...values])
  }
  return fields
}

export function normalizedAssetName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
}

function characterName(value) {
  const name = String(value).replace(
    /\s*[（([]\s*(?:V\.?\s*O\.?|O\.?\s*S\.?|画外音|画外声)\s*[）)\]]\s*$/iu,
    '',
  )
  return normalizedAssetName(characterIdentity(name).name)
}

function sceneIdentity(value) {
  let name = normalizedAssetName(value)
  const annotation = trailingSceneAnnotation(name)
  const detailText = annotation?.detail.replace(/[,，]\s*(?:内外景|内景|外景)\s*$/u, '').trim()
  const spaceAnnotation = annotation?.detail.match(/(?:^|[,，\s])(内外景|内景|外景)$/u)?.[1]
  const annotatedSpace =
    spaceAnnotation === '内景' ? 'interior' : spaceAnnotation === '外景' ? 'exterior' : ''
  if (
    annotation &&
    (SCENE_PERIOD.test(detailText) ||
      spaceAnnotation ||
      /(?:[-—–/·]\s*)(?:日|夜|day|night|dawn|dusk)$/iu.test(detailText))
  ) {
    const detail = sceneIdentity(SCENE_PERIOD.test(detailText) ? `- ${detailText}` : detailText)
    const base = sceneIdentity(annotation.name)
    return {
      name: base.name,
      period: detail.period || base.period,
      space: spaceAnnotation ? annotatedSpace : detail.space || base.space,
    }
  }
  const mixedSpace = /^(?:int\.\s*\/\s*ext\.|ext\.\s*\/\s*int\.|内外景)/iu.test(name)
  const space = mixedSpace
    ? ''
    : /^(?:int\.|内景)/iu.test(name)
      ? 'interior'
      : /^(?:ext\.|外景)/iu.test(name)
        ? 'exterior'
        : ''
  name = name.replace(
    /^(?:int\.(?:\s*\/\s*ext\.)?|ext\.(?:\s*\/\s*int\.)?|内外景|内景|外景)\s*[-—–/／·:]?\s*/iu,
    '',
  )
  const time = name.match(
    /(?:\s*[-—–/／·|]\s*|[（(])(?:白天|日间|白昼|夜晚|夜间|清晨|黎明|黄昏|傍晚|日|夜|day|night|dawn|dusk)[）)]?$/iu,
  )?.[0]
  name = time ? name.slice(0, -time.length).trim() : name
  const token = time?.replace(/[\s\-—–/／·|（()）]/gu, '') || ''
  const period = /^(?:白天|日间|白昼|日|day)$/u.test(token)
    ? 'day'
    : /^(?:夜晚|夜间|夜|night)$/u.test(token)
      ? 'night'
      : token
  return { name, space, period }
}

function trailingSceneAnnotation(name) {
  if (!name.endsWith(')')) return null
  let depth = 0
  for (let index = name.length - 1; index >= 0; index -= 1) {
    if (name[index] === ')') depth += 1
    else if (name[index] === '(' && --depth === 0) {
      return { name: name.slice(0, index).trim(), detail: name.slice(index + 1, -1).trim() }
    }
  }
  return null
}

export function explicitAssetMatch(asset, names) {
  if (asset.kind === 'character')
    return names.some((name) => characterName(name) === characterName(asset.name))
  if (asset.kind !== 'scene')
    return names.some((name) => normalizedAssetName(name) === normalizedAssetName(asset.name))
  const target = sceneIdentity(asset.name)
  return names.some((name) => {
    if (normalizedAssetName(name) === normalizedAssetName(asset.name)) return true
    const source = sceneIdentity(name)
    return (
      source.name === target.name &&
      (!target.space || source.space === target.space) &&
      (!target.period || source.period === target.period)
    )
  })
}

export function mentionsCharacter(text, asset, assets) {
  const name = characterName(asset.name)
  let source = normalizedAssetName(text)
  if (!name) return false
  // Prefer the longest registered identity: 林夏 must not select 林, nor
  // Ann select Anna. ASCII names additionally require word boundaries.
  for (const other of assets) {
    if (other.kind !== 'character') continue
    const longer = characterName(other.name)
    if (longer !== name && longer.includes(name)) source = source.split(longer).join(' ')
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'iu').test(source)
}
