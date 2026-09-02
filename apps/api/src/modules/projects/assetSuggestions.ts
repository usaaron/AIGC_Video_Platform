import type { Asset, ScriptAssetSuggestion, ScriptCreativeDirection } from '@seqora/contracts'

type ProjectVisualStyle = Exclude<ScriptCreativeDirection['style'], 'auto'>

export const SCRIPT_ASSET_FIELD_BOUNDARIES = [
  '场次',
  '剧情',
  '场景',
  '角色',
  '人物',
  '主角',
  '动作',
  '对白',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
  '关键物件',
  '关键道具',
  '物件',
  '道具',
  '服装',
  '衣装',
  '外观',
  '品牌',
  '品牌标识',
  'Logo',
  'logo',
]
export const SCRIPT_ASSET_STOP_WORDS = new Set(SCRIPT_ASSET_FIELD_BOUNDARIES)

const HUMAN_PORTRAIT_REQUIREMENTS =
  '影视 CG 风格，透明背景，Alpha 通道，无背景色，无光影效果，无投影，无高光，无环境反射，均匀平光，主体边缘清晰，人物面部大头照，头部和肩部完整入镜，五官清晰可调整，正面平视镜头，自然中性表情，不出现手部、文字和饰边，画面比例 1:1'
const ANIMAL_PORTRAIT_REQUIREMENTS =
  '影视 CG 风格，保留明确物种特征，透明背景，Alpha 通道，无背景色，无光影效果，无投影，无高光，无环境反射，均匀平光，主体边缘清晰，动物面部大头照，头部和肩颈完整入镜，正面平视镜头，自然中性表情，不出现前爪、文字和饰边，画面比例 1:1'
const CHARACTER_ASSET_NEGATIVE_PROMPT =
  '不要真人摄影感、卡通动漫、塑料皮肤、蜡像脸、过度磨皮、玻璃眼、空洞眼神、无瞳孔、斜视、眼睛不对称、面部漂移、五官融化、歪嘴、缺牙、畸形、解剖错误、多余肢体、手部、手指、文字、水印、logo、二维码、边框、背景色、投影、强高光、环境反射、低分辨率、模糊和压缩痕迹'
const ANIMAL_ASSET_NEGATIVE_PROMPT =
  '不要人类面孔、人类皮肤、人类身体、真人摄影感、物种混杂、额外头部、额外耳朵、额外眼睛、额外肢体、前爪入镜、解剖错误、塑料材质、文字、水印、logo、二维码、边框、背景色、投影、强高光、环境反射、低分辨率和模糊'
const SCENE_ASSET_NEGATIVE_PROMPT =
  '不要人物、动物、拥挤道具、悬浮物体、断开物体、穿帮接缝、重复纹理、贴图拉伸、抠像边、漂浮阴影、色温跳变、文字、水印、logo、二维码、UI、边框、低分辨率、像素化、过曝炸白和暗部死黑'
const PROP_ASSET_NEGATIVE_PROMPT =
  '不要人物、手部、多个重复物品、额外零件、悬浮部件、断裂、变形、比例错误、材质塑料感、复杂场景、文字、水印、logo、二维码、边框、投影、强反射、低分辨率和模糊'
const COSTUME_ASSET_NEGATIVE_PROMPT =
  '不要人物、模特、人体、脸、手部、衣架、多个重复服装、缺失部件、布料粘连、材质塑料感、复杂场景、文字、水印、logo、二维码、边框、投影、强反射、低分辨率和模糊'
const BRAND_ASSET_NEGATIVE_PROMPT =
  '不要人物、人体、手部、产品乱码、错别字、额外文字、水印、二维码、重复 Logo、变形图形、缺失字母、投影、环境反射、低分辨率和模糊'

export type ScriptAssetKind = ScriptAssetSuggestion['kind']
export type ScriptAssetNameIndex = Record<ScriptAssetKind, string[]>

export function normalizeScriptAssetSuggestion(
  suggestion: ScriptAssetSuggestion,
  sourceNames: ScriptAssetNameIndex,
  sourceContext = '',
  projectVisualStyle: ProjectVisualStyle = 'cinematic-cg',
): ScriptAssetSuggestion | null {
  const name = resolveAssetSuggestionName(suggestion, sourceNames)
  if (!name) return null

  const namedSuggestion: ScriptAssetSuggestion =
    name === suggestion.name.trim()
      ? suggestion
      : {
          ...suggestion,
          name,
          description: replaceAssetName(suggestion.description, suggestion.name, name),
          prompt: replaceAssetName(suggestion.prompt, suggestion.name, name),
          reason: replaceAssetName(suggestion.reason, suggestion.name, name),
        }
  const stylePrompt = `项目统一视觉风格：${projectVisualStyleLabel(projectVisualStyle)}，后续资产和视频必须保持这一风格，不要自行切换风格`

  if (namedSuggestion.kind === 'character') {
    const animal = namedSuggestion.attributes.subjectType === 'animal'
    const evidence = [
      namedSuggestion.name,
      namedSuggestion.description,
      namedSuggestion.prompt,
      namedSuggestion.reason,
    ].join('，')
    const nearbyScriptEvidence = characterEvidenceWindow(namedSuggestion.name, sourceContext)
    const profileEvidence = [evidence, nearbyScriptEvidence].filter(Boolean).join('，')
    const inferredGender = inferScriptCharacterGender(profileEvidence)
    const gender = animal
      ? 'unspecified'
      : inferredGender === 'unspecified'
        ? namedSuggestion.attributes.gender
        : inferredGender
    const exactAge = animal
      ? null
      : inferScriptCharacterExactAge(namedSuggestion.name, sourceContext) ||
        namedSuggestion.attributes.exactAge
    const ageSignal = inferScriptCharacterAgeSignal(profileEvidence)
    const ageGroup = animal
      ? namedSuggestion.attributes.ageGroup
      : exactAge
        ? ageGroupFromExactAge(exactAge)
        : ageSignal || namedSuggestion.attributes.ageGroup
    const identityTags = inferScriptCharacterIdentityTags(profileEvidence)
    const profileFacts = animal
      ? identityTags
      : [
          gender === 'male' ? '男性' : gender === 'female' ? '女性' : '',
          exactAge ? `${exactAge}岁` : scriptAgeLabel(ageGroup),
          ...identityTags,
        ].filter(Boolean)
    const profileSummary = profileFacts.length ? `角色背景：${profileFacts.join('，')}。` : ''
    const basePrompt = animal ? stripHumanProfileTerms(namedSuggestion.prompt) : namedSuggestion.prompt
    const description = namedSuggestion.description.includes(namedSuggestion.name)
      ? namedSuggestion.description
      : `${namedSuggestion.name}；${namedSuggestion.description}`
    const subjectProfile = animal
      ? [
          '动物角色',
          namedSuggestion.attributes.species || namedSuggestion.name,
          namedSuggestion.attributes.anthropomorphic ? '拟人化动物造型，保留物种面部特征' : '自然动物形态',
        ]
      : [
          '人物角色',
          namedSuggestion.attributes.gender === 'male'
            ? '男性'
            : namedSuggestion.attributes.gender === 'female'
              ? '女性'
              : '性别未指定',
          namedSuggestion.attributes.exactAge
            ? `${namedSuggestion.attributes.exactAge}岁`
            : scriptAgeLabel(namedSuggestion.attributes.ageGroup),
        ]
    return {
      ...namedSuggestion,
      description: appendAssetProfile(description, profileSummary),
      prompt: composeAssetPrompt([
        stylePrompt,
        ...subjectProfile,
        namedSuggestion.name,
        profileSummary,
        basePrompt,
        animal ? ANIMAL_PORTRAIT_REQUIREMENTS : HUMAN_PORTRAIT_REQUIREMENTS,
      ]),
      negativePrompt: composeAssetNegativePrompt(
        namedSuggestion.negativePrompt,
        animal ? ANIMAL_ASSET_NEGATIVE_PROMPT : CHARACTER_ASSET_NEGATIVE_PROMPT,
      ),
      attributes: {
        ...namedSuggestion.attributes,
        gender,
        ageGroup,
        exactAge,
        visualStyle: projectVisualStyle || 'cinematic-cg',
        framing: 'portrait',
        background: 'transparent',
      },
    }
  }

  if (namedSuggestion.kind === 'scene') {
    const sceneContext = [
      sourceContext,
      namedSuggestion.name,
      namedSuggestion.description,
      namedSuggestion.prompt,
    ].join('，')
    return {
      ...namedSuggestion,
      prompt: composeAssetPrompt([
        stylePrompt,
        namedSuggestion.name,
        namedSuggestion.prompt,
        '统一项目视觉风格的场景概念设计，空场景，无人物和动物，空间结构与前中后景关系清楚，关键出入口和动线明确，预留角色表演、动作和运镜空间，材质尺度统一，光照方向稳定，宽幅环境全景，适合后续多镜头复用',
      ]),
      negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, SCENE_ASSET_NEGATIVE_PROMPT),
      attributes: {
        ...namedSuggestion.attributes,
        sceneType: inferSceneType(sceneContext, namedSuggestion.attributes.sceneType),
        era: inferEra(sceneContext, namedSuggestion.attributes.era),
        visualStyle: projectVisualStyle || 'cinematic-cg',
        emptyScene: true,
        activitySpace: true,
      },
    }
  }

  if (namedSuggestion.kind === 'prop') {
    const propContext = [
      namedSuggestion.name,
      namedSuggestion.description,
      namedSuggestion.prompt,
      sourceContext,
    ].join('，')
    return {
      ...namedSuggestion,
      prompt: composeAssetPrompt([
        stylePrompt,
        namedSuggestion.name,
        namedSuggestion.prompt,
        '统一项目视觉风格的物品资产，单个物品独立展示，完整轮廓，正面主视图，结构和尺寸关系准确，材质、颜色、磨损与剧情状态明确，透明背景，Alpha 通道，无背景色，无投影，均匀平光，主体边缘清晰，适合跨镜头保持一致',
      ]),
      negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, PROP_ASSET_NEGATIVE_PROMPT),
      attributes: {
        ...namedSuggestion.attributes,
        condition: inferPropCondition(propContext, namedSuggestion.attributes.condition),
        visualStyle: projectVisualStyle || 'cinematic-cg',
        background: 'transparent',
      },
    }
  }

  if (namedSuggestion.kind === 'brand') {
    return {
      ...namedSuggestion,
      prompt: composeAssetPrompt([
        stylePrompt,
        namedSuggestion.name,
        namedSuggestion.prompt,
        '品牌或 Logo 资产，图形结构完整，字形和字母准确，构图清晰，适合在片尾、包装、场景招牌或界面中复用，透明背景，Alpha 通道，无背景色，无投影，均匀平光，主体边缘清晰',
        namedSuggestion.attributes.exactText
          ? `必须准确显示文字“${namedSuggestion.attributes.exactText}”`
          : '',
      ]),
      negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, BRAND_ASSET_NEGATIVE_PROMPT),
      attributes: {
        ...namedSuggestion.attributes,
        visualStyle: projectVisualStyle || 'cinematic-cg',
        background: 'transparent',
      },
    }
  }

  return {
    ...namedSuggestion,
    prompt: composeAssetPrompt([
      stylePrompt,
      namedSuggestion.name,
      namedSuggestion.prompt,
      '统一项目视觉风格的服装资产，单套服装平铺独立展示，完整呈现上装、下装和必要配件，版型、材质、纹理、配色与磨损状态清楚，不出现人物、人体、脸和衣架，透明背景，Alpha 通道，无背景色，无投影，均匀平光，边缘清晰，适合角色跨镜头造型一致',
    ]),
    negativePrompt: composeAssetNegativePrompt(namedSuggestion.negativePrompt, COSTUME_ASSET_NEGATIVE_PROMPT),
    attributes: {
      ...namedSuggestion.attributes,
      visualStyle: projectVisualStyle || 'cinematic-cg',
      presentation: 'flat',
    },
  }
}

function replaceAssetName(value: string, originalName: string, replacementName: string): string {
  const original = originalName.trim()
  return original && original !== replacementName ? value.replaceAll(original, replacementName) : value
}

function appendAssetProfile(description: string, profile: string): string {
  if (!profile || description.includes(profile)) return description
  return `${description.replace(/[。.!！?？\s]+$/u, '')}；${profile}`.slice(0, 500)
}

function composeAssetPrompt(fragments: readonly string[]): string {
  const prompt = fragments
    .map((fragment) => fragment.trim().replace(/[，。；;,]+$/u, ''))
    .filter(Boolean)
    .filter((fragment, index, values) => values.indexOf(fragment) === index)
    .join('，')
  return `${prompt.slice(0, 4_999)}。`
}

function composeAssetNegativePrompt(current: string, required: string): string {
  return composeAssetPrompt([current, required]).slice(0, 2_000)
}

function stripHumanProfileTerms(value: string): string {
  return value
    .replace(/\d{1,3}\s*岁/gu, '')
    .replace(/男性|女性|男人|女人|男孩|女孩|少年|少女|青年|中年|老年|儿童|婴儿/gu, '')
    .replace(/\b(?:male|female|boy|girl|young|middle-aged|senior)\b/giu, '')
    .replace(/[，,]{2,}/gu, '，')
    .trim()
}

export function fallbackAssetSuggestions(
  script: string,
  direction: ScriptCreativeDirection,
  projectVisualStyle: ProjectVisualStyle = 'cinematic-cg',
): { summary: string; assets: ScriptAssetSuggestion[] } {
  const visualStyle = projectVisualStyle || suggestionVisualStyle(direction)
  const characters = extractAssetNames(script, ['角色', '人物', '主角'], [], 4, 'character')
  const scenes = extractAssetNames(script, ['场景', '地点'], [], 4, 'scene')
  const props = extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 5, 'prop')
  const costumes = extractAssetNames(script, ['服装', '衣装', '外观'], [], 4, 'costume')
  const brands = extractAssetNames(script, ['品牌', '品牌标识', 'Logo', 'logo'], [], 2, 'brand')
  const assets: ScriptAssetSuggestion[] = [
    ...characters.map((name): ScriptAssetSuggestion => {
      const subjectType = inferScriptCharacterSubjectType(name)
      const gender = subjectType === 'animal' ? 'unspecified' : inferScriptCharacterGender(name)
      const ageGroup = inferScriptCharacterAge(name)
      const exactAge = inferScriptCharacterExactAge(name, script)
      const identityTags = inferScriptCharacterIdentityTags(name)
      const profile = [
        gender === 'male' ? '男性' : gender === 'female' ? '女性' : '',
        scriptAgeLabel(ageGroup),
        exactAge ? `${exactAge}岁` : '',
        ...identityTags,
      ].filter(Boolean)
      const profileText = profile.length ? profile.join('，') : '中文 AI 视频人物设定'
      return {
        kind: 'character',
        name,
        description: `从剧本中提取的主要角色：${name}${profile.length ? `（${profileText}）` : ''}`,
        prompt: `${name}，${profileText}，中文 AI 视频人物设定，面部清晰，造型统一，符合剧本风格，适合后续保持角色一致性。`,
        negativePrompt: '',
        reason: '角色在剧本中出现，需要先建立可复用的人物资产。',
        priority: 5,
        attributes: {
          type: 'character',
          subjectType,
          gender,
          ageGroup,
          exactAge,
          ethnicity: 'unspecified',
          skinTone: 'unspecified',
          eyeColor: 'unspecified',
          hairColor: 'unspecified',
          species: subjectType === 'animal' ? name : '',
          anthropomorphic: false,
          visualStyle,
          framing: 'full',
          bodyType: ageGroup === 'senior' ? 'balanced' : 'balanced',
          background: 'solid',
          faceStatus: 'pending',
          bodyStatus: 'pending',
          faceReference: null,
          bodyReference: null,
          portraitSource: 'ai-virtual',
          trustedPortrait: null,
          legStretch: false,
          turnaround: false,
          turnaroundLayout: 'sheet',
          appearanceVariants: [],
          activeAppearanceVariantId: null,
        },
      }
    }),
    ...scenes.map((name): ScriptAssetSuggestion => ({
      kind: 'scene',
      name,
      description: `从剧本中提取的核心场景：${name}`,
      prompt: `${name}，空场景，中文 AI 视频美术设定，空间层次清晰，预留人物表演和运镜空间，不出现人物。`,
      negativePrompt: '',
      reason: '场景会承载多个镜头，需要先统一空间和美术设定。',
      priority: 4,
      attributes: {
        type: 'scene',
        space: inferSceneSpace(name),
        sceneType: inferSceneType(name),
        era: inferEra(name),
        time: inferSceneTime(name),
        weather: inferWeather(script),
        mood: 'mystery',
        camera: 'wide',
        visualStyle,
        emptyScene: true,
        activitySpace: true,
      },
    })),
    ...props.map((name): ScriptAssetSuggestion => ({
      kind: 'prop',
      name,
      description: `从剧本中提取的关键道具：${name}`,
      prompt: `${name}，关键道具单品展示，材质细节清晰，形状稳定，纯色背景，适合后续多镜头复用。`,
      negativePrompt: '',
      reason: '该物件承载剧情信息或多次出现，需要保持外观连续。',
      priority: 4,
      attributes: {
        type: 'prop',
        category: inferPropCategory(name),
        material: inferPropMaterial(name),
        condition: 'used',
        view: 'front',
        background: 'solid',
        visualStyle,
      },
    })),
    ...costumes.map((name): ScriptAssetSuggestion => ({
      kind: 'costume',
      name,
      description: `从剧本中提取的核心服装：${name}`,
      prompt: `${name}，服装平铺展示，完整轮廓，材质和配色清晰，不出现人物脸部，适合保持角色造型一致。`,
      negativePrompt: '',
      reason: '服装影响角色跨镜头一致性，需要作为独立资产确认。',
      priority: 4,
      attributes: {
        type: 'costume',
        characterAssetId: null,
        audience: 'unisex',
        category: inferCostumeCategory(name),
        season: inferCostumeSeason(name),
        design: inferCostumeDesign(name),
        presentation: 'flat',
        visualStyle,
        turnaround: false,
      },
    })),
    ...brands.map((name): ScriptAssetSuggestion => ({
      kind: 'brand',
      name,
      description: `从剧本中提取的品牌或 Logo 资产：${name}`,
      prompt: `${name}，品牌 Logo 设计，图形结构完整，文字准确，透明背景，Alpha 通道，居中构图，适合广告片尾落版和场景复用。`,
      negativePrompt: '',
      reason: '品牌标识需要在广告、片尾或场景中保持一致，建议独立建立资产。',
      priority: 5,
      attributes: {
        type: 'brand',
        brandType: 'logo',
        usage: 'end-card',
        background: 'transparent',
        layout: 'centered',
        exactText: name,
        palette: '',
        visualStyle,
      },
    })),
  ]
  return {
    summary: '已根据剧本文本提取角色、场景、关键道具、核心服装和品牌标识建议，建议先确认高优先级资产。',
    assets,
  }
}

export function extractScriptAssetNameIndex(script: string): ScriptAssetNameIndex {
  return {
    character: extractAssetNames(script, ['角色', '人物', '主角'], [], 8, 'character'),
    scene: extractAssetNames(script, ['场景', '地点'], [], 8, 'scene'),
    prop: extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 10, 'prop'),
    costume: extractAssetNames(script, ['服装', '衣装', '外观'], [], 8, 'costume'),
    brand: extractAssetNames(script, ['品牌', '品牌标识', 'Logo', 'logo'], [], 4, 'brand'),
  }
}

function resolveAssetSuggestionName(
  suggestion: ScriptAssetSuggestion,
  sourceNames: ScriptAssetNameIndex,
): string | null {
  const direct = cleanAssetName(suggestion.name, suggestion.kind)
  if (isPlausibleAssetName(direct, suggestion.kind)) return direct

  const evidence = [suggestion.description, suggestion.prompt, suggestion.reason].join('\n')
  const evidenceMatch = [...sourceNames[suggestion.kind]]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => evidence.includes(candidate))
  if (evidenceMatch) return evidenceMatch

  return sourceNames[suggestion.kind].length === 1 ? sourceNames[suggestion.kind][0]! : null
}

export function extractAssetNames(
  script: string,
  fields: string[],
  fallback: string[],
  limit: number,
  kind: ScriptAssetKind,
): string[] {
  const values = extractScriptFieldValues(script, fields).flatMap((value) => splitAssetNameList(value, kind))
  const cleanedValues = values
    .map((value) => cleanAssetName(value, kind))
    .filter((value) => isPlausibleAssetName(value, kind))
    .filter((value) => !SCRIPT_ASSET_STOP_WORDS.has(value))
  const uniqueValues = deduplicateExtractedAssetNames(cleanedValues, kind)
  return (uniqueValues.length ? uniqueValues : fallback).slice(0, limit)
}

function extractScriptFieldValues(script: string, fields: string[]): string[] {
  const normalized = script
    .replace(/\*\*/gu, '')
    .replace(/\r/gu, '')
    .replace(/(^|\n)\s*(?:[-*]\s+|#{1,6}\s*)/gu, '$1')
  const targets = fields.map(escapeRegExp).join('|')
  const boundaries = SCRIPT_ASSET_FIELD_BOUNDARIES.map(escapeRegExp).join('|')
  const pattern = new RegExp(
    `(?:^|[\\n|｜])\\s*(?:${targets})\\s*[：:]\\s*([\\s\\S]*?)(?=(?:[\\n|｜])\\s*(?:${boundaries})\\s*[：:]|$)`,
    'gu',
  )
  return [...normalized.matchAll(pattern)].map((match) => (match[1] || '').trim()).filter(Boolean)
}

function splitAssetNameList(value: string, kind: ScriptAssetKind): string[] {
  if (kind === 'character') return splitCharacterNameList(value)
  if (kind === 'scene') return splitSceneNameList(value)
  return value
    .split(/[、，,；;]|(?:和|与)/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitCharacterNameList(value: string): string[] {
  const names: string[] = []
  for (const rawSection of value.replace(/\s+/gu, ' ').split(/[；;]/u)) {
    const section = rawSection.trim()
    if (
      !section ||
      /^(?:无)?背景角色/u.test(section) ||
      /^(?:无配角|无人物|无角色|无主角)(?:[，,]|$)/u.test(section)
    )
      continue

    const hasRoleLabel = /^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u.test(section)
    const withoutRoleLabel = section.replace(
      /^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u,
      '',
    )
    if (!withoutRoleLabel || /^(?:无配角|无人物|无人)$/u.test(withoutRoleLabel)) continue

    const identityClause = withoutRoleLabel.split(/[，,]/u)[0] || ''
    const candidates = identityClause
      .split(/[、]|(?:和|与)/u)
      .map((item) => item.trim())
      .filter(Boolean)
    names.push(
      ...(!hasRoleLabel &&
      /身穿|穿着|佩戴|戴着|跟随|跟在|穿(?:黑|白|红|橙|黄|绿|蓝|紫|灰|旧|新|深|浅|褪色)/u.test(identityClause)
        ? candidates.slice(0, 1)
        : candidates),
    )
  }
  return names
}

function splitSceneNameList(value: string): string[] {
  for (const segment of value.replace(/\s+/gu, ' ').split(/[，,；;]/u)) {
    const candidate = cleanSceneName(segment)
    if (isPlausibleAssetName(candidate, 'scene')) return [candidate]
  }
  return []
}

function cleanAssetName(value: string, kind: ScriptAssetKind): string {
  if (kind === 'character') return cleanCharacterName(value)
  if (kind === 'scene') return cleanSceneName(value)
  return cleanAssetNameBase(value)
}

function cleanAssetNameBase(value: string): string {
  const cleaned = value
    .replace(/^[\s·\-—]+/u, '')
    .replace(/^(?:资产|名称|物品|物件|道具|服装|衣装)[：:]\s*/u, '')
    .replace(
      /^(?:一位|一名|一个|这位|那位|该|某)?(?:[零〇一二三四五六七八九十百两\d]+岁(?:的)?|年迈的|年老的|老年的|少年的|少女的|年轻的|中年的|儿童的)/u,
      '',
    )
    .split(/[（(。.!！?？]/u)[0]!
    .split(/——|--|：|:/u)[0]!
    .trim()
  if (cleaned.length < 2) return ''
  return cleaned.length > 32 ? cleaned.slice(0, 32) : cleaned
}

function cleanCharacterName(value: string): string {
  return cleanAssetNameBase(value)
    .replace(/^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u, '')
    .split(
      /(?:身穿|穿着|佩戴|戴着|跟随|跟在|站在|位于|坐在|躲在|手持|拿着|抱着|先神情|随后|然后|低头|抬头|缩肩|强装)/u,
    )[0]!
    .split(/穿(?=(?:黑|白|红|橙|黄|绿|蓝|紫|灰|旧|新|深|浅|褪色))/u)[0]!
    .trim()
}

function cleanSceneName(value: string): string {
  return cleanAssetNameBase(value)
    .replace(/^(?:内景|外景|室内|室外)[：:]?\s*/u, '')
    .replace(
      /^(?:次日|当天|清晨|黎明|上午|中午|下午|傍晚|黄昏|夜晚|深夜|午夜|雨夜|雪夜)(?:前|后|时)?(?:的)?\s*/u,
      '',
    )
    .replace(/[，,；;].*$/u, '')
    .replace(/(?:内景|外景)$/u, '')
    .trim()
}

function isPlausibleAssetName(value: string, kind: ScriptAssetKind): boolean {
  if (!value || value.length < 2 || value.length > (kind === 'scene' ? 28 : 24)) return false
  if (kind === 'character') {
    if (
      /神情|表情|情绪|眼神|视线|瞳孔|紧张|镇定|惊慌|错愕|赔笑|皱眉|低头|抬头|缩肩|随后|然后|开始|继续|正在|站在|走向|看向|等待|说道|抬手|伸手|转身|位于|强装|抱臂|探头|交头接耳|寻找|声音/u.test(
        value,
      )
    )
      return false
    if (
      /^(?:无|未指定|主角|主要角色|配角|无配角|背景角色|角色|人物|众人|人群)$/u.test(value) ||
      /^(?:数名|多名|若干|一群|众多|所有|其余|围观|等待)?(?:弟子|群众|路人|村民|工作人员|士兵|侍卫|学生|乘客|客人|观众|人群|众人|人们)(?:们|[甲乙丙丁一二三四\d])?$/u.test(
        value,
      ) ||
      /^(?:数名|多名|若干|一群|众多|所有|其余|围观|等待).{0,8}(?:弟子|群众|路人|村民|工作人员|士兵|侍卫|学生|乘客|客人|观众|人群|众人|人们)(?:们)?$/u.test(
        value,
      )
    )
      return false
  }
  if (kind === 'scene') {
    if (
      /神情|表情|冷雾未散|晨雾未散|雾气未散|站满|立着|等待|位于|穿着|身穿|挂着|抱着|拿着|出现|翻涌|笼罩|散去|亮起|裂开|覆盖|坐着|站着|走向|看向|弟子|人物|角色/u.test(
        value,
      )
    )
      return false
    if (/^(?:清晨|黎明|上午|中午|下午|傍晚|黄昏|夜晚|深夜|午夜|阴天|晴天|冷雾|晨雾|黑雾|金光)$/u.test(value))
      return false
  }
  return true
}

function deduplicateExtractedAssetNames(values: string[], kind: ScriptAssetKind): string[] {
  const result: string[] = []
  for (const value of values) {
    const exactIndex = result.findIndex((existing) => existing === value)
    if (exactIndex >= 0) continue
    if (kind === 'scene') {
      const containingIndex = result.findIndex(
        (existing) =>
          Math.abs(existing.length - value.length) <= 8 &&
          (existing.startsWith(value) || value.startsWith(existing)),
      )
      if (containingIndex >= 0) {
        if (value.length < result[containingIndex]!.length) result[containingIndex] = value
        continue
      }
    }
    result.push(value)
  }
  return result
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function inferScriptCharacterSubjectType(text: string): 'human' | 'animal' {
  return /狗|猫|牛|马|羊|猪|鸡|鸭|鹅|鸟|鱼|狼|虎|熊|鹿|猴|犬|妖兽|灵兽/u.test(text) ? 'animal' : 'human'
}

function inferScriptCharacterGender(text: string): 'male' | 'female' | 'unspecified' {
  if (/老船夫|船夫|祖父|爷爷|爷|父亲|男人|男性|哥哥|弟弟|少爷|他\b/u.test(text)) return 'male'
  if (/翠翠|孙女|外孙女|女性|少女|姑娘|女孩|母亲|娘|妻|小姐|她\b/u.test(text)) return 'female'
  return 'unspecified'
}

function inferScriptCharacterAge(text: string): 'child' | 'teen' | 'young' | 'middle' | 'senior' {
  return inferScriptCharacterAgeSignal(text) || 'young'
}

function inferScriptCharacterAgeSignal(
  text: string,
): 'child' | 'teen' | 'young' | 'middle' | 'senior' | null {
  if (/老船夫|船夫|年迈|祖父|爷爷|老人|老年|晚年|七十|六十|五十/u.test(text)) return 'senior'
  if (/儿童|孩子|小孩|幼/u.test(text)) return 'child'
  if (/翠翠|少年|少女|十几|十三|十四|十五|十六|十七|十八/u.test(text)) return 'teen'
  if (/中年|三十|四十/u.test(text)) return 'middle'
  if (/青年|年轻|二十|十九/u.test(text)) return 'young'
  return null
}

function inferScriptCharacterExactAge(name: string, script: string): number | null {
  const exactFromContext = exactAgeNearCharacterName(name, script)
  if (exactFromContext) return exactFromContext
  return exactAgeFromText(name)
}

function exactAgeNearCharacterName(name: string, script: string): number | null {
  const nearby = characterEvidenceWindow(name, script)
  const nearbyAge = exactAgeFromText(nearby)
  if (nearbyAge) return nearbyAge

  const escapedName = escapeRegExp(name)
  const ageToken = '[0-9零〇一二三四五六七八九十百两]{1,4}'
  const patterns = [
    new RegExp(`(${ageToken})岁(?:的)?[^\\n|｜。；;，,、]{0,12}${escapedName}`, 'u'),
    new RegExp(`${escapedName}[^\\n|｜。；;，,、]{0,12}(${ageToken})岁`, 'u'),
  ]
  for (const pattern of patterns) {
    const match = script.match(pattern)
    const parsed = match ? parseAgeToken(match[1] || '') : null
    if (parsed) return parsed
  }
  return null
}

function characterEvidenceWindow(name: string, script: string): string {
  if (!name || !script) return ''
  const occurrences: string[] = []
  let searchFrom = 0
  while (searchFrom < script.length) {
    const index = script.indexOf(name, searchFrom)
    if (index < 0) break
    const lineStart = Math.max(
      script.lastIndexOf('\n', index),
      script.lastIndexOf('｜', index),
      script.lastIndexOf('|', index),
    )
    const lineEndCandidates = [
      script.indexOf('\n', index),
      script.indexOf('｜', index),
      script.indexOf('|', index),
    ].filter((boundary) => boundary >= 0)
    const lineEnd = lineEndCandidates.length ? Math.min(...lineEndCandidates) : script.length
    const line = script.slice(lineStart + 1, lineEnd)
    const listPart = line.split(/[、；;]/u).find((part) => part.includes(name))
    occurrences.push((listPart || line).trim())
    searchFrom = index + name.length
  }
  return (
    occurrences.find((value) =>
      /\d{1,3}\s*岁|男性|女性|男|女|老年|中年|青年|少年|少女|儿童|镖师|剑客|长老|导演|医生|将军/u.test(value),
    ) ||
    occurrences[0] ||
    ''
  )
}

function ageGroupFromExactAge(age: number): 'child' | 'teen' | 'young' | 'middle' | 'senior' {
  if (age < 13) return 'child'
  if (age <= 18) return 'teen'
  if (age < 30) return 'young'
  if (age < 50) return 'middle'
  return 'senior'
}

function exactAgeFromText(text: string): number | null {
  const digitMatch = text.match(/(\d{1,3})岁/u)
  if (digitMatch) return parseAgeToken(digitMatch[1] || '')
  const chineseMatch = text.match(/([零〇一二三四五六七八九十百两]+)岁/u)
  if (!chineseMatch) return null
  return parseAgeToken(chineseMatch[1] || '')
}

function parseAgeToken(value: string): number | null {
  const parsed = /^\d+$/u.test(value) ? Number(value) : parseChineseAge(value)
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 120 ? parsed : null
}

function parseChineseAge(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return NaN
  const digitMap: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  let total = 0
  let current = 0
  let hasUnit = false
  for (const char of trimmed) {
    if (char === '百') {
      total += (current || 1) * 100
      current = 0
      hasUnit = true
      continue
    }
    if (char === '十') {
      total += (current || 1) * 10
      current = 0
      hasUnit = true
      continue
    }
    const digit = digitMap[char]
    if (digit === undefined) return NaN
    current = digit
  }
  return hasUnit ? total + current : current
}

function inferScriptCharacterIdentityTags(text: string): string[] {
  const tags = [
    /船夫|摆渡|渡船/u.test(text) ? '船夫/摆渡人' : '',
    /翠翠|少女|姑娘|女孩/u.test(text) ? '湘西少女' : '',
    /祖父|爷爷|老人/u.test(text) ? '长辈' : '',
    /黄狗|狗|犬/u.test(text) ? '家犬' : '',
    /镖师|镖客/u.test(text) ? '镖师' : '',
    /剑客|剑士|女剑客/u.test(text) ? '剑客' : '',
    /长老|宗主|掌门|弟子/u.test(text) ? '宗门身份' : '',
    /导演|摄影师|记者/u.test(text) ? '影像从业者' : '',
    /医生|医师|药师/u.test(text) ? '医者' : '',
    /将军|士兵|军人|校尉/u.test(text) ? '军旅身份' : '',
  ].filter(Boolean)
  return [...new Set(tags)]
}

function scriptAgeLabel(ageGroup: 'child' | 'teen' | 'young' | 'middle' | 'senior'): string {
  return {
    child: '儿童',
    teen: '少年/少女',
    young: '青年',
    middle: '中年',
    senior: '老年',
  }[ageGroup]
}

function suggestionVisualStyle(
  direction: ScriptCreativeDirection,
): Exclude<ScriptCreativeDirection['style'], 'auto'> {
  return direction.style === 'auto' ? 'cinematic-cg' : direction.style
}

export function projectVisualStyleLabel(value: string | undefined): string {
  return (
    (
      {
        photorealistic: '仿真人',
        'cinematic-cg': 'CG风',
        'chinese-2d': '2D风',
        'chinese-3d': '3D国漫风',
        anime: '日漫风',
        storybook: '绘本风',
      } as Record<string, string>
    )[value || 'cinematic-cg'] || 'CG风'
  )
}

function inferSceneSpace(name: string): 'interior' | 'exterior' {
  return /室内|屋|房|店|铺|工厂|车厢|房间|大厅|暗房|药铺/u.test(name) ? 'interior' : 'exterior'
}

function inferSceneType(
  name: string,
  fallback:
    | 'city'
    | 'street'
    | 'residential'
    | 'commercial'
    | 'nature'
    | 'ancient'
    | 'industrial'
    | 'fantasy' = 'city',
): 'city' | 'street' | 'residential' | 'commercial' | 'nature' | 'ancient' | 'industrial' | 'fantasy' {
  if (/修仙|仙侠|仙门|宗门|山门|青云宗|灵石|灵脉|妖兽|秘境|玄幻|奇幻|神殿|魔法|浮空|天穹/u.test(name))
    return 'fantasy'
  if (/古|宫|城门|边城|药铺|江湖|门派/u.test(name)) return 'ancient'
  if (/工厂|车间|管线|工业|暗房/u.test(name)) return 'industrial'
  if (/森林|山|河|雪坡|荒野/u.test(name)) return 'nature'
  if (/商店|市场|餐厅|药铺/u.test(name)) return 'commercial'
  if (/街|路|站台|车站/u.test(name)) return 'street'
  if (/住宅|家|卧室/u.test(name)) return 'residential'
  if (/浮空|魔法|神殿/u.test(name)) return 'fantasy'
  return fallback
}

function inferEra(
  name: string,
  fallback: 'ancient' | 'recent' | 'modern' | 'future' = 'modern',
): 'ancient' | 'recent' | 'modern' | 'future' {
  if (
    /修仙|仙侠|仙门|宗门|山门|青云宗|灵石|灵脉|妖兽|秘境|玄幻|奇幻|古|剑|宫|江湖|门派|药铺|古门/u.test(name)
  )
    return 'ancient'
  if (/未来|赛博|浮空|企业霓虹|机器人/u.test(name)) return 'future'
  if (/民国|旧式|老式/u.test(name)) return 'recent'
  return fallback
}

function inferSceneTime(name: string): 'dawn' | 'day' | 'sunset' | 'night' {
  if (/黎明|清晨|晨/u.test(name)) return 'dawn'
  if (/黄昏|傍晚|日落/u.test(name)) return 'sunset'
  if (/夜|午夜|暗/u.test(name)) return 'night'
  return 'day'
}

function inferWeather(script: string): 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog' {
  if (/雪/u.test(script)) return 'snow'
  if (/雨/u.test(script)) return 'rain'
  if (/雾|霾/u.test(script)) return 'fog'
  if (/阴|云/u.test(script)) return 'cloudy'
  return 'clear'
}

function inferPropCategory(
  name: string,
): 'weapon' | 'vehicle' | 'furniture' | 'electronics' | 'jewelry' | 'food' | 'daily' | 'other' {
  if (/刀|剑|枪|弓|矛|武器/u.test(name)) return 'weapon'
  if (/车|船|机/u.test(name)) return 'vehicle'
  if (/桌|椅|柜|床/u.test(name)) return 'furniture'
  if (/手机|电脑|芯片|相机|胶片|屏/u.test(name)) return 'electronics'
  if (/戒指|项链|玉|首饰/u.test(name)) return 'jewelry'
  if (/饭|茶|酒|食物/u.test(name)) return 'food'
  return 'daily'
}

function inferPropMaterial(
  name: string,
): 'wood' | 'metal' | 'glass' | 'fabric' | 'leather' | 'ceramic' | 'mixed' {
  if (/刀|剑|枪|金属|铁|铜|银/u.test(name)) return 'metal'
  if (/木|桌|椅|柜/u.test(name)) return 'wood'
  if (/玻璃|镜/u.test(name)) return 'glass'
  if (/布|帕|衣/u.test(name)) return 'fabric'
  if (/皮|革/u.test(name)) return 'leather'
  if (/瓷|碗|杯/u.test(name)) return 'ceramic'
  return 'mixed'
}

function inferPropCondition(
  text: string,
  fallback: 'new' | 'used' | 'aged' | 'damaged',
): 'new' | 'used' | 'aged' | 'damaged' {
  if (/破损|损坏|断裂|残缺|碎裂/u.test(text)) return 'damaged'
  if (/年久|陈旧|老旧|锈蚀|腐朽/u.test(text)) return 'aged'
  if (/旧|使用痕迹|磨损|划痕/u.test(text)) return 'used'
  return fallback
}

function inferCostumeCategory(
  name: string,
): 'daily' | 'formal' | 'professional' | 'uniform' | 'ancient' | 'ceremonial' | 'fantasy' | 'armor' {
  if (/战甲|盔甲|护甲/u.test(name)) return 'armor'
  if (/古|剑客|侠|汉服|衣装/u.test(name)) return 'ancient'
  if (/制服|校服|军装/u.test(name)) return 'uniform'
  if (/礼服|婚服/u.test(name)) return 'ceremonial'
  if (/职业|工装/u.test(name)) return 'professional'
  if (/魔法|奇幻/u.test(name)) return 'fantasy'
  return 'daily'
}

function inferCostumeSeason(name: string): 'spring-summer' | 'autumn-winter' | 'all-season' {
  if (/雪|冬|厚|披风|风衣/u.test(name)) return 'autumn-winter'
  if (/夏|薄|短袖/u.test(name)) return 'spring-summer'
  return 'all-season'
}

function inferCostumeDesign(name: string): 'minimal' | 'luxury' | 'retro' | 'future' | 'chinese' {
  if (/古|国风|汉服|剑客|侠/u.test(name)) return 'chinese'
  if (/未来|赛博|机能/u.test(name)) return 'future'
  if (/旧|复古|民国/u.test(name)) return 'retro'
  if (/华丽|礼服|宫廷/u.test(name)) return 'luxury'
  return 'minimal'
}

export function deduplicateAssetSuggestions(
  suggestions: ScriptAssetSuggestion[],
  existingAssets: readonly Pick<Asset, 'kind' | 'name'>[],
): ScriptAssetSuggestion[] {
  const seen = new Set(existingAssets.map(assetSuggestionKey))
  const result: ScriptAssetSuggestion[] = []
  for (const suggestion of [...suggestions].sort((left, right) => right.priority - left.priority)) {
    const key = assetSuggestionKey(suggestion)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(suggestion)
  }
  return result
}

export function assetSuggestionKey(asset: Pick<Asset, 'kind' | 'name'>): string {
  return `${asset.kind}:${asset.name.trim().toLocaleLowerCase('zh-CN')}`
}
