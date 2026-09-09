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
import { naturalScreenplayEvents, type ScreenplayEvent } from './screenplayParsing.js'

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
const DETAIL_SHOT_CONTENT = /发现|证据|伤口|钥匙|药|手机|屏幕|戒指|照片/u

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
    const durationShotCount = sceneDuration ? Math.max(1, Math.ceil(sceneDuration / 15)) : 1
    const requestedShotCount = Math.min(
      maxShots - shots.length,
      Math.max(explicitSpecs.length, durationShotCount),
    )

    if (requestedShotCount === 1 && !explicitSpecs.length && !sceneDuration) {
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

    const fallbackSpecs = fallbackDirectorShotSpecs(
      fields,
      requestedShotCount,
      isWebSeries,
      paragraph,
      explicitSpecs.length,
    )
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
  paragraph: string,
  explicitCount: number,
): DirectorShotSpec[] {
  const actionSegments = splitFieldBeats(fields.动作 || fields.剧情 || '')
  const dialogueSegments = spokenDialogueCues(fields.对白)
  const orderedGroups = orderedSceneGroups(naturalScreenplayEvents(paragraph), count)
  // An underspecified scene must not invent a second version of the same action.
  const actualCount = Math.max(
    explicitCount,
    orderedGroups.length || Math.min(count, Math.max(1, actionSegments.length, dialogueSegments.length)),
  )
  const actionGroups = partitionForDirectorShots(actionSegments, actualCount)
  const dialogueGroups = partitionForDirectorShots(dialogueSegments, actualCount)
  return Array.from({ length: actualCount }, (_, index) => {
    const events = orderedGroups[index]
    const action = events
      ? events
          .filter((event) => event.kind === 'action')
          .map((event) => event.text)
          .join('\n')
      : actionGroups[index]?.join('；').trim()
    const dialogue = events
      ? events
          .filter((event) => event.kind === 'dialogue')
          .map((event) => event.text)
          .join('；')
      : dialogueGroups[index]?.join('；').trim()
    const establishesScene = index === 0
    const fallbackContent = establishesScene
      ? `先建立${fields.场景 || '当前场景'}的空间、人物位置和可见阻力，再推进本场前半段行动`
      : `承接上一镜尾帧，推进本场后半段行动并形成${index === count - 1 ? '明确结果' : '下一处变化'}`
    const content = action || fallbackContent
    const framing = directorFraming({}, content, dialogue || '', index)
    return {
      task: `${establishesScene ? '建立行动与阻力' : index === actualCount - 1 ? '完成转折与结果' : '推进选择与后果'}：${headExcerpt(content, 100)}`,
      framing,
      position: establishesScene ? '从能交代空间关系的稳定机位开始' : '保持人物视线高度和轴线连续',
      camera: inferredDirectorCamera(content, dialogue || '', establishesScene),
      content,
      ...(dialogue ? { dialogue } : {}),
      sound: events
        ? events
            .filter((event) => event.kind === 'sound')
            .map((event) => event.text)
            .join('；')
        : fields.声音 || nonSpokenSoundCues(fields.对白).join('；'),
      ...(fields.光影 ? { lighting: fields.光影 } : {}),
      ...(isWebSeries ? { performance: '对白与动作同时推进，听者必须有同步视线和表情反应' } : {}),
    }
  })
}

function orderedSceneGroups(events: ScreenplayEvent[], count: number): ScreenplayEvent[][] {
  if (!events.length) return []
  const beats: ScreenplayEvent[][] = []
  for (const event of events) {
    if (event.kind === 'action' || !beats.length) beats.push([event])
    else beats.at(-1)!.push(event)
  }
  // Keep cues beside their triggering action; split oversized paragraphs at
  // sentence boundaries before balancing action and speaking time.
  const expanded = beats.flatMap((beat) => {
    const [first, ...cues] = beat
    if (first?.kind !== 'action') return [beat]
    if (beats.length >= count && first.text.length <= 180) return [beat]
    const actions = splitFieldBeats(first.text)
    return actions.map((text, index) => [
      { kind: 'action' as const, text },
      ...(index === actions.length - 1 ? cues : []),
    ])
  })
  const groupCount = Math.min(count, expanded.length)
  const weights = expanded.map((beat) =>
    beat.reduce(
      (sum, event) =>
        sum +
        (event.kind === 'dialogue'
          ? Math.max(1, dialogueTextForTiming(event.text).length / 4)
          : event.kind === 'action'
            ? Math.max(1, event.text.length / 25)
            : 0.5),
      0,
    ),
  )
  const groups: ScreenplayEvent[][] = []
  let start = 0
  for (let group = 0; group < groupCount; group += 1) {
    const remaining = groupCount - group
    if (remaining === 1) {
      groups.push(expanded.slice(start).flat())
      break
    }
    const target = weights.slice(start).reduce((sum, weight) => sum + weight, 0) / remaining
    let end = start + 1
    let sum = 0
    let distance = Number.POSITIVE_INFINITY
    for (let index = start; index <= expanded.length - remaining; index += 1) {
      sum += weights[index]!
      const candidateDistance = Math.abs(sum - target)
      if (candidateDistance < distance) {
        distance = candidateDistance
        end = index + 1
      }
    }
    groups.push(expanded.slice(start, end).flat())
    start = end
  }
  return groups
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
  const durations = plans.map((plan) =>
    Math.min(
      15,
      Math.max(
        minimum,
        Math.round(plan.duration || 0),
        Math.ceil(dialogueTextForTiming(plan.dialogue).length / 4) + 1,
      ),
    ),
  )
  const target = Math.min(15 * plans.length, sceneDuration || plans.length * 10)
  let remaining = target - durations.reduce((sum, duration) => sum + duration, 0)
  while (remaining > 0) {
    const candidates = durations
      .map((duration, index) => ({ duration, index }))
      .filter(({ duration, index }) => duration < 15 && !plans[index]?.duration)
      .sort((left, right) => left.duration - right.duration)
    if (!candidates.length) break
    durations[candidates[0]!.index]! += 1
    remaining -= 1
  }
  return durations
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
  if (DETAIL_SHOT_CONTENT.test(content)) return '特写'
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
  if (DETAIL_SHOT_CONTENT.test(content)) {
    return '以稳定特写呈现本镜关键细节及必要手部动作，焦点跟随信息变化；对白同步进行，不因说话而移开关键细节'
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
    fieldPart('镜头任务', plan.task || '完成当前叙事阶段并产生可见变化', 220),
    ...(shotIndex === 0
      ? [fieldPart('目标', direction.目标, 180), fieldPart('阻力', direction.阻力, 180)]
      : []),
    ...(shotIndex === shotCount - 1 ? [fieldPart('变化', direction.变化, 180)] : []),
    fieldPart('场景', fields.场景 || '沿用上一场空间与时间', 420),
    fieldPart('角色', fields.角色 || '沿用上一场所有角色', 520),
    fieldPart('服装', fields.服装, 260),
    fieldPart('关键物件', fields.关键物件, 260),
    fieldPart('资产引用', plan.assetReferences, 300),
    ...(shotIndex === 0 ? [fieldPart('入场状态', direction.入场状态, 320)] : []),
    `镜头边界：本镜是当前场次第 ${shotIndex + 1}/${shotCount} 个导演镜头，只完成本镜任务；允许多个连续动作，但不得重演上一镜或提前执行下一镜内容`,
    '镜头隔离：只执行本镜的镜头内容和对白；不得执行、复述或让人物说出本场其他导演镜头的动作、对白或结尾状态',
    dialogue
      ? `对白执行：本镜仅使用下方对白并按发生顺序完整说完，共 ${spokenDialogueCues(dialogue).length} 句；保留动作和听者反应的时间，不得重复到其他镜头或为凑句数新增台词`
      : '对白执行：本镜没有可用对白，不得借用其他镜头台词；只保留本镜的动作声和环境声',
    fieldPart('镜头内容', content, 720),
    fieldPart('对白', dialogue || '无对白，仅保留必要动作声和环境声', 420),
    fieldPart('表演', plan.performance, 300),
    fieldPart('声音', plan.sound ?? fields.声音 ?? nonSpokenSoundCues(fields.对白).join('；'), 280),
    fieldPart('景别', framing, 120),
    fieldPart('机位', plan.position || '保持人物运动轴线和视线方向稳定', 220),
    fieldPart('构图', plan.composition || fields.构图 || `${framing}，主体位置和前中后景关系清晰`, 260),
    fieldPart('光影', plan.lighting || fields.光影 || '沿用场景既定光源方向与色温', 240),
    fieldPart('运镜', plan.camera || inferredDirectorCamera(content, dialogue, shotIndex === 0), 320),
    fieldPart('首帧', plan.firstFrame, 320),
    fieldPart('尾帧', plan.lastFrame, 320),
    `执行时序：0-1秒确认首帧和人物位置，1-${Math.max(2, duration - 1)}秒连续完成镜头内容、对白与听者反应，最后1秒固定尾帧人物位置、视线和物件状态`,
    fieldPart(
      '衔接',
      shotIndex === shotCount - 1
        ? fields.衔接
        : '本镜动作完成后保留人物位置、视线、服装与物件状态，下一镜从此继续',
      320,
    ),
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
