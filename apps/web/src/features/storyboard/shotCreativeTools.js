import { NEGATIVE_PROMPT_PRESETS, negativePromptForVideoProject } from '../prompts/negativePromptPresets'

const CHARACTER_CUES = /人物|角色|女人|男人|女孩|男孩|女生|男生|少女|少年/
const SCENE_CUES = /室内|室外|街道|站台|车站|房间|客厅|办公室|森林|海边|山谷|广场/
const PROP_CUES = /道具|拿起|打开|握着|放下|钥匙|信|照片|手机|雨伞|胶片/
const COSTUME_CUES = /服装|衣服|穿着|风衣|制服|礼服|战甲/
const AUDIO_CUES = /声音|音效|配音|雨声|雷声|脚步|音乐|环境音/

export const SHOT_PROMPT_TEMPLATES = [
  {
    id: 'establishing',
    label: '建立空间',
    description: '先交代场景关系，再让主体进入画面。',
    build: ({ shot, assets }) => {
      const scene = namesForKind(assets, 'scene')[0] || '当前场景'
      return `交代${scene}的空间关系，${shot?.framing || '中景'}构图，前景、中景、背景层次清晰，主体位置稳定`
    },
  },
  {
    id: 'character-action',
    label: '角色行动',
    description: '明确人物动作和动作连续性。',
    build: ({ assets }) => {
      const character = namesForKind(assets, 'character')[0] || '角色'
      return `${character}完成一个明确、连续的动作，保持发型、服装、面部特征和身体比例一致，动作自然`
    },
  },
  {
    id: 'emotion-closeup',
    label: '情绪特写',
    description: '把注意力集中到眼神、表情和情绪变化。',
    build: ({ assets }) => {
      const character = namesForKind(assets, 'character')[0] || '角色'
      return `${character}情绪清晰，眼神和微表情自然，浅景深突出面部细节，避免面部漂移`
    },
  },
  {
    id: 'prop-detail',
    label: '关键道具',
    description: '突出关键或多次出现的物件，保持材质和位置稳定。',
    build: ({ assets }) => {
      const prop = namesForKind(assets, 'prop')[0] || '关键道具'
      return `${prop}作为关键道具清晰可见，材质、形状、比例和位置稳定，不被人物或其他物体遮挡`
    },
  },
]

export const NEGATIVE_PROMPT_TEMPLATE_OPTIONS = [
  {
    id: 'project',
    label: '项目默认',
    description: '按项目类型合并仿真人视频与视频质量约束。',
    getPrompt: (project) => negativePromptForVideoProject(project),
  },
  {
    id: 'realisticVideo',
    label: '仿真人视频',
    description: '排除拍摄设备、背景穿帮、面部漂移和肢体错误。',
    getPrompt: () => NEGATIVE_PROMPT_PRESETS.realisticVideo,
  },
  {
    id: 'video',
    label: '视频质量',
    description: '排除闪烁、跳帧、重影、低清和视频结构错误。',
    getPrompt: () => NEGATIVE_PROMPT_PRESETS.video,
  },
  {
    id: 'character',
    label: '人物一致性',
    description: '排除塑料皮肤、眼部错误、手部畸形和解剖错误。',
    getPrompt: () => NEGATIVE_PROMPT_PRESETS.character,
  },
  {
    id: 'scene',
    label: '场景质量',
    description: '排除重复纹理、悬浮物体、色温跳变和不自然画面。',
    getPrompt: () => NEGATIVE_PROMPT_PRESETS.scene,
  },
  {
    id: 'productAd',
    label: '产品广告',
    description: '排除塑料材质、过度反光、悬浮和多余道具。',
    getPrompt: () => NEGATIVE_PROMPT_PRESETS.productAd,
  },
]

export function suggestedAssetsForShot(shot, assets = []) {
  const selectedIds = new Set(shot?.assetIds || [])
  const text = normalizeText([shot?.title, shot?.prompt, shot?.framing].filter(Boolean).join(' '))

  return assets
    .map((asset) => {
      const score = assetMatchScore(asset, text)
      return {
        asset,
        score,
        selected: selectedIds.has(asset.id),
        reason: reasonForAsset(asset, text),
      }
    })
    .filter((item) => item.selected || item.score > 0)
    .sort((left, right) => {
      if (left.selected !== right.selected) return left.selected ? -1 : 1
      return right.score - left.score
    })
}

export function suggestedAssetIdsForShot(shot, assets = []) {
  const selectedIds = new Set(shot?.assetIds || [])
  const suggestions = suggestedAssetsForShot(shot, assets)
  const ids = suggestions.map(({ asset }) => asset.id)
  return [...new Set([...selectedIds, ...ids])].slice(0, 12)
}

export function applyShotPromptTemplate(prompt, templateId, context = {}) {
  const template = SHOT_PROMPT_TEMPLATES.find((item) => item.id === templateId)
  if (!template) return String(prompt || '')

  const current = String(prompt || '')
    .replace(/镜头模板：[^。\n]+[。]?/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
  const clause = `镜头模板：${template.label}。${template.build(context)}。`
  return current ? `${current}，${clause}` : clause
}

export function negativePromptOptions(project) {
  return NEGATIVE_PROMPT_TEMPLATE_OPTIONS.map((option) => ({
    ...option,
    prompt: option.getPrompt(project),
  }))
}

export function applyNegativePromptTemplate(prompt, presetId, project) {
  const option = NEGATIVE_PROMPT_TEMPLATE_OPTIONS.find((item) => item.id === presetId)
  if (!option) return String(prompt || '')

  const current = String(prompt || '')
    .replace(/负面约束：[\s\S]*$/g, '')
    .trim()
  const clause = `负面约束：${option.getPrompt(project)}`
  return current ? `${current}\n${clause}` : clause
}

export function characterConsistencyIssues(shot, assets = []) {
  const selectedIds = new Set(shot?.assetIds || [])
  const text = normalizeText([shot?.title, shot?.prompt].filter(Boolean).join(' '))
  const referencedCharacters = assets.filter(
    (asset) => asset.kind === 'character' && selectedIds.has(asset.id),
  )
  const mentionedCharacters = assets.filter(
    (asset) => asset.kind === 'character' && text.includes(normalizeText(asset.name)),
  )
  const issues = []

  if ((CHARACTER_CUES.test(text) || mentionedCharacters.length > 0) && referencedCharacters.length === 0) {
    issues.push({
      code: 'missing-character-asset',
      severity: 'warning',
      message: '镜头包含人物线索，但还没有引用角色资产。',
    })
  }

  for (const asset of referencedCharacters) {
    const attributes = asset.attributes || {}
    if (attributes.faceStatus !== 'approved' || !attributes.faceReference) {
      issues.push({
        code: 'face-reference-missing',
        severity: 'error',
        assetId: asset.id,
        message: `角色「${asset.name}」缺少已确认的面部基准图。`,
      })
    }
    if (attributes.bodyStatus !== 'approved' || !attributes.bodyReference) {
      issues.push({
        code: 'body-reference-missing',
        severity: 'warning',
        assetId: asset.id,
        message: `角色「${asset.name}」缺少已确认的全身基准图。`,
      })
    }
    if (attributes.turnaround) {
      const views = new Set(
        (attributes.turnaroundReferences || []).map((reference) => reference.view).filter(Boolean),
      )
      if (!['front', 'side', 'back'].every((view) => views.has(view))) {
        issues.push({
          code: 'turnaround-incomplete',
          severity: 'warning',
          assetId: asset.id,
          message: `角色「${asset.name}」的 front / side / back 三视图还不完整。`,
        })
      }
    }
  }

  if (referencedCharacters.length > 1 && !/主角|配角|前景|背景|对视|交谈|两人|多人/.test(text)) {
    issues.push({
      code: 'multiple-character-roles',
      severity: 'warning',
      message: '镜头引用了多个角色，建议在提示词中说明主次和互动关系。',
    })
  }

  return issues
}

function assetMatchScore(asset, text) {
  let score = 0
  const name = normalizeText(asset.name)
  if (name && text.includes(name)) score += 10

  for (const term of candidateTerms(`${asset.description || ''} ${asset.prompt || ''}`)) {
    if (text.includes(normalizeText(term))) score += term.length >= 3 ? 2 : 1
  }

  const cue = {
    character: CHARACTER_CUES,
    scene: SCENE_CUES,
    prop: PROP_CUES,
    costume: COSTUME_CUES,
    audio: AUDIO_CUES,
  }[asset.kind]
  if (cue?.test(text)) score += 1
  return score
}

function reasonForAsset(asset, text) {
  if (normalizeText(asset.name) && text.includes(normalizeText(asset.name))) return '镜头文字直接提到该资产。'
  if (asset.kind === 'character' && CHARACTER_CUES.test(text))
    return '镜头出现人物线索，建议保持角色基准一致。'
  if (asset.kind === 'scene' && SCENE_CUES.test(text)) return '镜头出现地点或空间线索。'
  if (asset.kind === 'prop' && PROP_CUES.test(text)) return '镜头出现关键物件或持有动作。'
  if (asset.kind === 'costume' && COSTUME_CUES.test(text)) return '镜头出现服装或穿着线索。'
  if (asset.kind === 'audio' && AUDIO_CUES.test(text)) return '镜头出现声音或环境音线索。'
  return '资产描述与镜头提示词存在关键词匹配。'
}

function namesForKind(assets = [], kind) {
  return assets
    .filter((asset) => asset.kind === kind)
    .map((asset) => asset.name)
    .filter(Boolean)
}

function candidateTerms(value) {
  return value
    .split(/[，。！？、；：,.!?:;\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 16)
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
}
