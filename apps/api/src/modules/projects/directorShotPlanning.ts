import {
  continuityNoteFor,
  dialogueTextForTiming,
  fieldPart,
  headExcerpt,
  isHookParagraph,
  nonSpokenSoundCues,
  parseSceneDirectionFields,
  parseShotFields,
  scenesShareVisualContinuity,
  spokenDialogueCues,
  splitFieldBeats,
  splitScriptIntoSceneShots,
  type SceneDirectionFields,
  type ScriptParagraph,
  type ShotDraft,
} from './shotPlanning.js'

const DIRECTOR_SHOT_FIELD_NAMES = ['镜头1', '镜头2', '镜头3'] as const
const DIRECTOR_DETAIL_LABELS = [
  '时长',
  '任务',
  '镜头任务',
  '叙事任务',
  '景别',
  '机位',
  '构图',
  '运镜',
  '内容',
  '镜头内容',
  '动作',
  '对白',
  '表演',
  '声音',
  '光影',
  '首帧',
  '尾帧',
  '资产引用',
] as const

type DirectorShotSpec = {
  duration?: number
  task?: string
  framing?: string
  position?: string
  composition?: string
  camera?: string
  content?: string
  dialogue?: string
  performance?: string
  sound?: string
  lighting?: string
  firstFrame?: string
  lastFrame?: string
  assetReferences?: string
}

type DirectorSceneFields = ReturnType<typeof parseShotFields>

export function splitScriptIntoSmartSceneShots(
  paragraphs: ScriptParagraph[],
  maxShots: number,
  isWebSeries = false,
): ShotDraft[] {
  const shots: ShotDraft[] = []
  for (const [sceneIndex, scriptParagraph] of paragraphs.entries()) {
    if (shots.length >= maxShots) break
    const paragraph = scriptParagraph.text
    const fields = parseShotFields(paragraph)
    const direction = parseSceneDirectionFields(paragraph)
    const explicitSpecs = directorShotSpecs(fields)
    const sceneDuration = parseDurationSeconds(fields.时长)
    const durationShotCount =
      sceneDuration && sceneDuration > 15 ? Math.min(3, Math.max(2, Math.round(sceneDuration / 10))) : 1
    const requestedShotCount = Math.max(explicitSpecs.length, durationShotCount)

    if (requestedShotCount === 1 && !explicitSpecs.length) {
      const [sceneShot] = splitScriptIntoSceneShots([scriptParagraph], 1, isWebSeries)
      if (!sceneShot) continue
      const previousParagraph = paragraphs[sceneIndex - 1]
      const continuesPreviousScene =
        sceneIndex > 0 &&
        !scriptParagraph.forceShotBreakBefore &&
        scenesShareVisualContinuity(previousParagraph?.text || '', paragraph)
      shots.push({
        ...sceneShot,
        title: `镜头 ${String(shots.length + 1).padStart(2, '0')}`,
        episodeBreakBefore: scriptParagraph.forceEpisodeBreakBefore,
        continuityMode:
          shots.length === 0 || !continuesPreviousScene ? ('independent' as const) : ('continue' as const),
        continuityNote: continuityNoteFor(previousParagraph?.text || '', '上一场', {
          entryState: direction.入场状态,
          exitState: direction.出场状态,
          current: paragraph,
          visualContinuity: continuesPreviousScene,
        }),
      })
      continue
    }

    const fallbackSpecs = fallbackDirectorShotSpecs(fields, requestedShotCount, isWebSeries)
    const plans = fallbackSpecs.map((fallback, index) => ({ ...fallback, ...explicitSpecs[index] }))
    const durations = distributeSceneDuration(sceneDuration, plans, isWebSeries)
    const previousParagraph = paragraphs[sceneIndex - 1]
    const continuesPreviousScene =
      sceneIndex > 0 &&
      !scriptParagraph.forceShotBreakBefore &&
      scenesShareVisualContinuity(previousParagraph?.text || '', paragraph)

    for (const [shotIndex, plan] of plans.entries()) {
      if (shots.length >= maxShots) return shots
      const duration = durations[shotIndex] || minimumShotDuration(isWebSeries)
      const content = plan.content || fields.动作 || fields.剧情 || paragraph
      const dialogue = plan.dialogue || ''
      const framing = directorFraming(plan, content, dialogue, shotIndex)
      const previousSource =
        shotIndex > 0
          ? directorContinuitySource(fields, plans[shotIndex - 1]!)
          : previousParagraph?.text || ''
      const currentSource = directorContinuitySource(fields, plan)
      shots.push({
        title: `场次 ${fields.场次 || String(sceneIndex + 1)} · 导演镜头 ${shotIndex + 1}`,
        framing,
        duration,
        prompt: compactDirectorShotPrompt(
          fields,
          direction,
          plan,
          content,
          dialogue,
          framing,
          duration,
          shotIndex,
          plans.length,
        ),
        negativePrompt: '',
        imageUrl: null,
        episodeBreakBefore: shotIndex === 0 && scriptParagraph.forceEpisodeBreakBefore,
        episodeKind:
          isHookParagraph(paragraph) && shotIndex === plans.length - 1
            ? ('hook' as const)
            : ('standard' as const),
        continuityMode:
          shots.length === 0 || (shotIndex === 0 && !continuesPreviousScene)
            ? ('independent' as const)
            : ('continue' as const),
        continuityNote: continuityNoteFor(previousSource, shotIndex > 0 ? '上一镜' : '上一场', {
          entryState: shotIndex === 0 ? direction.入场状态 : plan.firstFrame,
          exitState: shotIndex === plans.length - 1 ? direction.出场状态 : plan.lastFrame,
          current: currentSource,
          visualContinuity: shotIndex > 0 || continuesPreviousScene,
        }),
      })
    }
  }
  return shots
}

function directorShotSpecs(fields: DirectorSceneFields): DirectorShotSpec[] {
  return DIRECTOR_SHOT_FIELD_NAMES.flatMap((field) => {
    const source = fields[field]?.trim()
    return source ? [parseDirectorShotSpec(source)] : []
  })
}

function parseDirectorShotSpec(source: string): DirectorShotSpec {
  const labels = DIRECTOR_DETAIL_LABELS.join('|')
  const normalized = source.replace(new RegExp(`，\\s*(?=(?:${labels})\\s*[：:])`, 'gu'), '；')
  const pattern = new RegExp(
    `(?:^|[；;])\\s*(${labels})\\s*[：:]\\s*([\\s\\S]*?)(?=(?:[；;])\\s*(?:${labels})\\s*[：:]|$)`,
    'gu',
  )
  const details = new Map<string, string>()
  for (const match of normalized.matchAll(pattern)) {
    const label = match[1]?.trim()
    const value = match[2]?.trim()
    if (label && value) details.set(label, value)
  }
  const read = (...keys: string[]) => keys.map((key) => details.get(key)).find(Boolean)
  const duration = parseDurationSeconds(read('时长'))
  return {
    ...(duration ? { duration } : {}),
    ...(read('任务', '镜头任务', '叙事任务') ? { task: read('任务', '镜头任务', '叙事任务')! } : {}),
    ...(read('景别') ? { framing: read('景别')! } : {}),
    ...(read('机位') ? { position: read('机位')! } : {}),
    ...(read('构图') ? { composition: read('构图')! } : {}),
    ...(read('运镜') ? { camera: read('运镜')! } : {}),
    ...(read('内容', '镜头内容', '动作')
      ? { content: read('内容', '镜头内容', '动作')! }
      : details.size
        ? {}
        : { content: source }),
    ...(read('对白') ? { dialogue: read('对白')! } : {}),
    ...(read('表演') ? { performance: read('表演')! } : {}),
    ...(read('声音') ? { sound: read('声音')! } : {}),
    ...(read('光影') ? { lighting: read('光影')! } : {}),
    ...(read('首帧') ? { firstFrame: read('首帧')! } : {}),
    ...(read('尾帧') ? { lastFrame: read('尾帧')! } : {}),
    ...(read('资产引用') ? { assetReferences: read('资产引用')! } : {}),
  }
}

function fallbackDirectorShotSpecs(
  fields: DirectorSceneFields,
  count: number,
  isWebSeries: boolean,
): DirectorShotSpec[] {
  const actionSegments = splitFieldBeats(fields.动作 || fields.剧情 || '')
  const dialogueSegments = spokenDialogueCues(fields.对白)
  const actionGroups = partitionForDirectorShots(actionSegments, count)
  const dialogueGroups = partitionForDirectorShots(dialogueSegments, count)
  return Array.from({ length: count }, (_, index) => {
    const action = actionGroups[index]?.join('；').trim()
    const dialogue = dialogueGroups[index]?.join('；').trim()
    const establishesScene = index === 0
    const fallbackContent = establishesScene
      ? `先建立${fields.场景 || '当前场景'}的空间、人物位置和可见阻力，再推进本场前半段行动`
      : `承接上一镜尾帧，推进本场后半段行动并形成${index === count - 1 ? '明确结果' : '下一处变化'}`
    const content = action || fallbackContent
    const framing = directorFraming({}, content, dialogue || '', index)
    return {
      task: establishesScene ? '建立场景空间、威胁来源和人物目标' : '承接行动并完成本场信息变化',
      framing,
      position: establishesScene ? '从能交代空间关系的稳定机位开始' : '保持人物视线高度和轴线连续',
      camera: inferredDirectorCamera(content, dialogue || '', establishesScene),
      content,
      ...(dialogue ? { dialogue } : {}),
      sound: fields.声音 || nonSpokenSoundCues(fields.对白).join('；'),
      ...(fields.光影 ? { lighting: fields.光影 } : {}),
      ...(isWebSeries ? { performance: '对白与动作同时推进，听者必须有同步视线和表情反应' } : {}),
    }
  })
}

function partitionForDirectorShots<T>(values: T[], count: number): T[][] {
  const groups = Array.from({ length: count }, () => [] as T[])
  if (!values.length) return groups
  values.forEach((value, index) => {
    const groupIndex = Math.min(count - 1, Math.floor((index * count) / values.length))
    groups[groupIndex]!.push(value)
  })
  return groups
}

function distributeSceneDuration(
  sceneDuration: number | null,
  plans: DirectorShotSpec[],
  isWebSeries: boolean,
): number[] {
  const minimum = minimumShotDuration(isWebSeries)
  const explicit = plans.map((plan) =>
    plan.duration ? Math.min(15, Math.max(minimum, Math.round(plan.duration))) : null,
  )
  if (explicit.every((duration) => duration !== null)) return explicit as number[]

  const target = Math.max(
    minimum * plans.length,
    Math.min(15 * plans.length, sceneDuration || plans.length * 10),
  )
  const explicitTotal = explicit.reduce<number>((sum, duration) => sum + (duration || 0), 0)
  const missingCount = explicit.filter((duration) => duration === null).length
  const remainingTarget = Math.max(minimum * missingCount, target - explicitTotal)
  const base = Math.floor(remainingTarget / missingCount)
  let remainder = remainingTarget - base * missingCount
  return explicit.map((duration) => {
    if (duration !== null) return duration
    const distributed = base + (remainder > 0 ? 1 : 0)
    remainder = Math.max(0, remainder - 1)
    return Math.min(15, Math.max(minimum, distributed))
  })
}

function minimumShotDuration(isWebSeries: boolean): number {
  return isWebSeries ? 3 : 4
}

function parseDurationSeconds(value: string | undefined): number | null {
  const text = String(value || '').trim()
  if (!text) return null
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*分(?:钟)?(?:\s*(\d+(?:\.\d+)?)\s*秒)?/u)
  if (minuteMatch?.[1]) {
    return Math.max(1, Math.round(Number(minuteMatch[1]) * 60 + Number(minuteMatch[2] || 0)))
  }
  const secondMatch = text.match(/(\d+(?:\.\d+)?)\s*秒/u)
  return secondMatch?.[1] ? Math.max(1, Math.round(Number(secondMatch[1]))) : null
}

function directorFraming(plan: DirectorShotSpec, content: string, dialogue: string, index: number): string {
  if (plan.framing) return headExcerpt(plan.framing, 80)
  if (/全貌|环境|空间|合围|尸群|人群|建筑|城市|街道/u.test(content) && index === 0) return '俯拍大全景'
  if (/跑|冲|追|撤退|进入|离开|战斗|移动/u.test(content)) return '中景'
  if (/发现|证据|伤口|钥匙|药|手机|屏幕|戒指|照片/u.test(content)) return '特写'
  if (dialogueTextForTiming(dialogue).length || /表情|眼神|迟疑|恐惧|愤怒|悲伤/u.test(content)) {
    return '中近景'
  }
  return index === 0 ? '全景' : '中景'
}

function inferredDirectorCamera(content: string, dialogue: string, establishesScene: boolean): string {
  if (establishesScene && /环境|空间|合围|尸群|人群|街道|城市/u.test(content)) {
    return '从高位远景缓慢下降或推进，在不切镜的前提下建立空间关系'
  }
  if (/跑|冲|追|撤退|进入|离开|战斗|移动/u.test(content)) {
    return '人物视线高度的中景跟拍，摄影机与主体平行移动并保持方向稳定'
  }
  if (dialogueTextForTiming(dialogue).length || /表情|眼神|迟疑|恐惧|愤怒|悲伤/u.test(content)) {
    return '从双人关系构图缓慢推近说话者面部，听者保留在前景并同步反应'
  }
  return '稳定推进主体，结尾停在下一镜可承接的位置'
}

function compactDirectorShotPrompt(
  fields: DirectorSceneFields,
  direction: SceneDirectionFields,
  plan: DirectorShotSpec,
  content: string,
  dialogue: string,
  framing: string,
  duration: number,
  shotIndex: number,
  shotCount: number,
): string {
  return [
    fieldPart('场次', fields.场次 || '未编号场次', 24),
    fieldPart('剧情', fields.剧情 || '本场继续推进当前冲突', 320),
    fieldPart('镜头任务', plan.task || '完成当前叙事阶段并产生可见变化', 220),
    fieldPart('目标', direction.目标 || '角色完成当前可见行动', 180),
    fieldPart('阻力', direction.阻力 || '当前环境或对手阻碍角色推进', 180),
    fieldPart('变化', direction.变化 || '动作结束后角色状态发生可见变化', 180),
    fieldPart('场景', fields.场景 || '沿用上一场空间与时间', 420),
    fieldPart('角色', fields.角色 || '沿用上一场所有角色', 520),
    fieldPart('服装', fields.服装, 260),
    fieldPart('关键物件', fields.关键物件, 260),
    fieldPart('资产引用', plan.assetReferences, 300),
    ...(shotIndex === 0 ? [fieldPart('入场状态', direction.入场状态, 320)] : []),
    `镜头边界：本镜是当前场次第 ${shotIndex + 1}/${shotCount} 个导演镜头，只完成本镜任务；允许多个连续动作，但不得重演上一镜或提前执行下一镜内容`,
    fieldPart('镜头内容', content, 720),
    fieldPart('对白', dialogue || '无对白，仅保留必要动作声和环境声', 420),
    fieldPart('表演', plan.performance, 300),
    fieldPart('声音', plan.sound || fields.声音 || nonSpokenSoundCues(fields.对白).join('；'), 280),
    fieldPart('景别', framing, 120),
    fieldPart('机位', plan.position || '保持人物运动轴线和视线方向稳定', 220),
    fieldPart('构图', plan.composition || fields.构图 || `${framing}，主体位置和前中后景关系清晰`, 260),
    fieldPart('光影', plan.lighting || fields.光影 || '沿用场景既定光源方向与色温', 240),
    fieldPart('运镜', plan.camera || inferredDirectorCamera(content, dialogue, shotIndex === 0), 320),
    fieldPart('首帧', plan.firstFrame, 320),
    fieldPart('尾帧', plan.lastFrame, 320),
    `执行时序：0-1秒确认首帧和人物位置，1-${Math.max(2, duration - 1)}秒连续完成镜头内容、对白与听者反应，最后1秒固定尾帧人物位置、视线和物件状态`,
    fieldPart('衔接', fields.衔接 || '人物位置、视线、服装、物件和光线状态交给下一镜', 320),
    ...(shotIndex === shotCount - 1 ? [fieldPart('出场状态', direction.出场状态, 320)] : []),
  ]
    .filter(Boolean)
    .join('｜')
}

function directorContinuitySource(fields: DirectorSceneFields, plan: DirectorShotSpec): string {
  return [
    fieldPart('场景', fields.场景, 320),
    fieldPart('角色', fields.角色, 420),
    fieldPart('动作', plan.content || fields.动作, 520),
    fieldPart('入场状态', plan.firstFrame, 240),
    fieldPart('出场状态', plan.lastFrame, 240),
  ]
    .filter(Boolean)
    .join('｜')
}
