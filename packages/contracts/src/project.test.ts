import { describe, expect, it } from 'vitest'
import {
  createAssetSchema,
  createShotSchema,
  enrichScriptRequestSchema,
  generateScriptAssetSuggestionsRequestSchema,
  generateScriptOutlinesRequestSchema,
  generateScriptRequestSchema,
  generateScriptScenesRequestSchema,
  generateScriptStructureRequestSchema,
  generateShotsRequestSchema,
  scriptAssetSuggestionsResultSchema,
  scriptOutlineOptionsResultSchema,
  scriptReviewResultSchema,
  scriptScenesResultSchema,
  scriptStructureResultSchema,
  updateAssetSchema,
  updateShotSchema,
} from './project.js'

const character = {
  type: 'character' as const,
  subjectType: 'human' as const,
  gender: 'female' as const,
  ageGroup: 'young' as const,
  exactAge: null,
  species: '',
  anthropomorphic: false,
  visualStyle: 'cinematic-cg' as const,
  framing: 'full' as const,
  bodyType: 'balanced' as const,
  background: 'solid' as const,
  faceStatus: 'pending' as const,
  bodyStatus: 'pending' as const,
  faceReference: null,
  bodyReference: null,
  legStretch: false,
  turnaround: false,
  turnaroundLayout: 'sheet' as const,
}

const reference = (index: number) => ({ id: `media-${index}`, url: `/media/${index}`, name: `${index}.png` })

describe('asset contracts', () => {
  it('accepts at most three imported reference images', () => {
    const input = {
      kind: 'character',
      sourceMode: 'import',
      name: '林夏',
      attributes: character,
      references: [reference(1), reference(2), reference(3)],
    }

    const parsed = createAssetSchema.parse(input)
    expect(parsed.attributes).toMatchObject({
      portraitSource: 'ai-virtual',
      trustedPortrait: null,
    })
    expect(
      createAssetSchema.safeParse({ ...input, references: [...input.references, reference(4)] }).success,
    ).toBe(false)
  })

  it('rejects attributes belonging to another asset type', () => {
    expect(
      createAssetSchema.safeParse({
        kind: 'scene',
        sourceMode: 'generate',
        name: '车站',
        attributes: character,
      }).success,
    ).toBe(false)
  })

  it('does not inject create defaults into partial asset updates', () => {
    expect(updateAssetSchema.parse({ status: 'confirmed' })).toEqual({ status: 'confirmed' })
    expect(updateAssetSchema.safeParse({}).success).toBe(false)
  })
})

describe('shot contracts', () => {
  it('stores a bounded continuity context and defaults it for older clients', () => {
    expect(createShotSchema.parse({ title: '镜头 01' }).continuityNote).toBe('')
    expect(updateShotSchema.parse({ continuityNote: '上一场人物停在门口，本场从推门动作继续。' })).toEqual({
      continuityNote: '上一场人物停在门口，本场从推门动作继续。',
    })
  })

  it('does not inject create defaults into partial shot updates', () => {
    expect(updateShotSchema.parse({ prompt: '更稳定的运镜' })).toEqual({ prompt: '更稳定的运镜' })
    expect(updateShotSchema.safeParse({}).success).toBe(false)
  })
})

describe('script workflow contracts', () => {
  it('applies safe defaults to script generation and shot splitting requests', () => {
    expect(generateScriptOutlinesRequestSchema.parse({ idea: '浪漫悲情武侠长片' })).toMatchObject({
      idea: '浪漫悲情武侠长片',
      count: 4,
      direction: {
        style: 'auto',
        composition: 'auto',
        lighting: 'auto',
        camera: 'auto',
        focus: 'balanced',
      },
    })
    expect(generateScriptStructureRequestSchema.parse({ outline: outlineOption() })).toMatchObject({
      idea: '',
      outline: expect.objectContaining({ id: 'outline-1' }),
      direction: expect.objectContaining({ style: 'auto' }),
    })
    expect(
      generateScriptScenesRequestSchema.parse({
        outline: outlineOption(),
        structure: scriptStructureContent(),
      }),
    ).toMatchObject({
      idea: '',
      sceneCount: 12,
      outline: expect.objectContaining({ id: 'outline-1' }),
      structure: expect.objectContaining({ title: '雪夜归剑' }),
    })
    expect(
      generateScriptAssetSuggestionsRequestSchema.parse({ script: '场次：1｜角色：女剑客' }),
    ).toMatchObject({
      script: '场次：1｜角色：女剑客',
      direction: expect.objectContaining({ style: 'auto' }),
    })
    expect(generateScriptRequestSchema.parse({ draft: '雨夜车站' })).toMatchObject({
      mode: 'quick',
      segment: { goal: '', targetMinutes: 5 },
      direction: {
        style: 'auto',
        composition: 'auto',
        lighting: 'auto',
        camera: 'auto',
        focus: 'balanced',
      },
    })
    expect(
      generateScriptRequestSchema.parse({
        draft: '第一集已有内容',
        mode: 'segment',
        segment: { goal: '继续写第二段' },
      }),
    ).toMatchObject({
      mode: 'segment',
      segment: { goal: '继续写第二段', targetMinutes: 5 },
    })
    expect(enrichScriptRequestSchema.parse({ script: '场次：1｜剧情：找到胶片' }).direction).toMatchObject({
      style: 'auto',
      composition: 'auto',
      lighting: 'auto',
      camera: 'auto',
      focus: 'balanced',
    })
    expect(generateShotsRequestSchema.parse({})).toMatchObject({ maxShots: 8, mode: 'scene' })
    expect(generateShotsRequestSchema.parse({ mode: 'beat', maxShots: 36 })).toMatchObject({
      maxShots: 36,
      mode: 'beat',
    })
  })

  it('validates script outline option results', () => {
    const outline = outlineOption()
    expect(
      scriptOutlineOptionsResultSchema.safeParse({
        outlines: [outline, { ...outline, id: 'outline-2' }, { ...outline, id: 'outline-3' }],
        generatedAt: new Date().toISOString(),
      }).success,
    ).toBe(true)
  })

  it('validates selected outline plot structure results', () => {
    expect(scriptStructureResultSchema.safeParse(scriptStructure()).success).toBe(true)
  })

  it('validates scene-by-scene script results', () => {
    expect(scriptScenesResultSchema.safeParse(scriptScenes()).success).toBe(true)
  })

  it('validates generated asset suggestions from a script', () => {
    expect(scriptAssetSuggestionsResultSchema.safeParse(scriptAssetSuggestions()).success).toBe(true)
  })

  it('validates structured professional review results', () => {
    const dimensions = ['plot', 'character', 'dialogue', 'style', 'composition', 'lighting', 'camera'].map(
      (key) => ({ key, score: 80, finding: '问题明确', suggestion: '给出可执行修改' }),
    )
    expect(
      scriptReviewResultSchema.safeParse({
        score: 80,
        verdict: '具备制作基础',
        dimensions,
        priorityActions: ['补足角色目标'],
        generatedAt: new Date().toISOString(),
      }).success,
    ).toBe(true)
  })
})

function outlineOption() {
  return {
    id: 'outline-1',
    title: '雪夜归剑',
    logline: '一名退隐剑客在婚约与复仇之间选择守护故土。',
    protagonist: '退隐女剑客，想摆脱江湖旧债并保护爱人。',
    conflict: '外部是门派追杀和朝廷围捕，内部是她对复仇的执念。',
    tone: '浪漫、悲情、中国风武侠',
    ending: '牺牲式圆满，保留余韵。',
    summary:
      '女剑客隐居边城，只想与药师完成婚约，却在雪夜发现旧门派屠城令。她被迫重拾长剑，一边护送百姓撤离，一边追查师门背叛。药师逐渐发现她的复仇会吞噬两人的未来，于是选择陪她进入最后一战。高潮中女剑客放弃杀死仇人，转而救下城中孩子，最终与药师天各一方，留下守护江湖的新传说。',
    estimatedDuration: '约100分钟',
  }
}

function scriptStructure() {
  return {
    title: '雪夜归剑',
    premise: '退隐女剑客在婚约与复仇之间选择守护故土。',
    mainPlot: '雪夜屠城令打破隐居生活，女剑客从护送百姓开始追查师门背叛，最终放弃复仇救下孩子。',
    acts: [
      {
        id: 'act-1',
        title: '第一幕：雪夜旧债',
        purpose: '建立主角的隐居愿望和旧门派威胁。',
        summary: '女剑客准备婚约，旧门派屠城令迫近，她被迫暴露身份。',
        keyBeats: ['婚约建立', '屠城令出现', '旧敌逼近'],
        turningPoint: '她决定护送百姓离城。',
        estimatedMinutes: 25,
      },
      {
        id: 'act-2',
        title: '第二幕：同行裂痕',
        purpose: '推进追查和情感矛盾。',
        summary: '女剑客与药师同行，发现师门背叛与亲近之人有关。',
        keyBeats: ['护送受阻', '线索指向师门', '药师质疑复仇'],
        turningPoint: '她确认真正仇人仍在城内。',
        estimatedMinutes: 45,
      },
      {
        id: 'act-3',
        title: '第三幕：归剑成全',
        purpose: '完成最终选择和情绪落点。',
        summary: '女剑客在杀仇人和救孩子之间选择后者，完成守护主题。',
        keyBeats: ['重返城门', '仇人现身', '放弃复仇救人'],
        turningPoint: '她与药师天各一方。',
        estimatedMinutes: 30,
      },
    ],
    subplots: [
      {
        id: 'subplot-1',
        title: '爱情副线',
        characters: ['女剑客', '药师'],
        arc: '从隐居婚约到价值分歧，再到互相成全。',
        payoff: '最终离别保留余韵。',
      },
    ],
    characterArcs: [
      {
        character: '女剑客',
        desire: '摆脱江湖旧债。',
        obstacle: '复仇执念和门派追杀。',
        change: '从复仇者变成守护者。',
      },
    ],
    visualDirection: '雪夜、边城、旧门派符号和克制武侠动作贯穿全片。',
    nextStep: '继续细化人物关系、三处关键战斗和离别段落。',
    generatedAt: new Date().toISOString(),
  }
}

function scriptStructureContent() {
  const { generatedAt: _generatedAt, ...content } = scriptStructure()
  return content
}

function scriptScenes() {
  const scene = {
    id: 'scene-1',
    order: 1,
    actId: 'act-1',
    title: '雪夜婚约',
    location: '边城药铺',
    timeOfDay: '夜',
    characters: ['女剑客', '药师'],
    purpose: '建立隐居愿望',
    conflict: '旧身份与新生活冲突',
    plot: '女剑客准备收起长剑，与药师确认婚约，却被窗外急促马蹄打断。',
    action: '她把剑匣推入柜底，药师点亮桌上油灯，门外雪水沿台阶流进屋内。',
    dialogue: ['女剑客：明日之后，我不再握剑。', '药师：那就先活过今夜。'],
    visualNotes: '室内暖灯与窗外冷雪形成对比，长剑只露出一角。',
    transition: '门外马蹄声引出下一场旧敌抵达。',
    estimatedMinutes: 5,
  }
  return {
    title: '雪夜归剑分场剧本',
    sourceStructureTitle: '雪夜归剑',
    scenes: Array.from({ length: 6 }, (_, index) => ({
      ...scene,
      id: `scene-${index + 1}`,
      order: index + 1,
      title: `分场 ${index + 1}`,
    })),
    continuityNotes: '长剑、雪夜、药铺灯光和女剑客的隐居状态需要连续。',
    nextStep: '继续把每场扩写成含完整动作和对白的剧本文本。',
    generatedAt: new Date().toISOString(),
  }
}

function scriptAssetSuggestions() {
  return {
    summary: '从分场剧本中提取出需要保持一致的核心资产。',
    assets: [
      {
        kind: 'character',
        name: '女剑客',
        description: '贯穿主线的退隐女剑客，从复仇者转向守护者。',
        prompt: '退隐女剑客，清晰五官，克制神情，古风武侠角色，全身造型统一。',
        negativePrompt: '',
        reason: '主角贯穿所有关键场次，需要优先建立角色一致性。',
        priority: 5,
        attributes: character,
      },
      {
        kind: 'scene',
        name: '边城药铺',
        description: '婚约与旧敌逼近的核心室内场景。',
        prompt: '古风边城药铺空场景，木柜、药屉、暖色油灯，窗外雪夜，预留人物表演空间。',
        negativePrompt: '',
        reason: '开场和人物关系建立会重复使用。',
        priority: 4,
        attributes: {
          type: 'scene',
          space: 'interior',
          sceneType: 'ancient',
          era: 'ancient',
          time: 'night',
          weather: 'snow',
          mood: 'romantic',
          camera: 'wide',
          visualStyle: 'cinematic-cg',
          emptyScene: true,
          activitySpace: true,
        },
      },
      {
        kind: 'prop',
        name: '旧长剑',
        description: '女剑客身份和选择的核心物件。',
        prompt: '古风旧长剑道具，金属剑身有使用痕迹，朴素剑柄，正面展示，纯色背景。',
        negativePrompt: '',
        reason: '长剑作为关键物件跨场出现，影响动作和连续性。',
        priority: 5,
        attributes: {
          type: 'prop',
          category: 'weapon',
          material: 'metal',
          condition: 'aged',
          view: 'front',
          background: 'solid',
          visualStyle: 'cinematic-cg',
        },
      },
      {
        kind: 'costume',
        name: '女剑客雪夜衣装',
        description: '主角在雪夜行动段落使用的核心服装。',
        prompt: '古风女剑客深色冬季衣装，布料与皮革混合，轻便护腕，完整平铺展示。',
        negativePrompt: '',
        reason: '主角服装需要跨场统一，避免生成时造型漂移。',
        priority: 4,
        attributes: {
          type: 'costume',
          audience: 'female',
          category: 'ancient',
          season: 'autumn-winter',
          design: 'chinese',
          presentation: 'flat',
          visualStyle: 'cinematic-cg',
          turnaround: false,
        },
      },
    ],
    generatedAt: new Date().toISOString(),
    warnings: [],
  }
}
