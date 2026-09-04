import type { CreateShot, GenerateShotsRequest, ScriptEpisode } from '@seqora/contracts'
import { FORCE_EPISODE_BREAK_MARKER, FORCE_SHOT_BREAK_MARKER } from '@seqora/contracts'

const COMPLETE_SCENE_FIELDS = [
  '场次',
  '剧情',
  '场景',
  '角色',
  '动作',
  '对白',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
] as const

export function assignShotEpisodes<
  T extends {
    duration: number
    episodeKind?: 'standard' | 'hook'
    episodeBreakBefore?: boolean
    continuityMode?: 'independent' | 'continue'
    continuityNote?: string
  },
>(
  shots: T[],
  targetDurationSeconds: GenerateShotsRequest['episodeDurationSeconds'],
): Array<
  T & {
    episodeNumber: number
    episodeTitle: string
    episodeKind: 'standard' | 'hook'
  }
> {
  let episodeNumber = 1
  let episodeDuration = 0
  let breakAfterHook = false

  return shots.map((input) => {
    const isHook = input.episodeKind === 'hook'
    const startsNewEpisode = (input.episodeBreakBefore || breakAfterHook) && episodeDuration > 0
    const exceedsDuration =
      !isHook && episodeDuration > 0 && episodeDuration + input.duration > targetDurationSeconds

    if (startsNewEpisode || exceedsDuration) {
      episodeNumber += 1
      episodeDuration = 0
    }

    const isFirstShotInEpisode = episodeDuration === 0
    episodeDuration += input.duration
    breakAfterHook = isHook

    return {
      ...input,
      episodeNumber,
      episodeTitle: `第 ${episodeNumber} 集`,
      episodeKind: isHook ? ('hook' as const) : ('standard' as const),
      // Episodes are separate production units and never inherit a prior episode's tail frame.
      continuityMode: isFirstShotInEpisode ? ('independent' as const) : (input.continuityMode ?? 'continue'),
      // Do not leave the previous episode's textual handoff attached to its first shot.
      continuityNote: isFirstShotInEpisode ? '' : input.continuityNote,
    }
  })
}

export type ScriptParagraph = {
  text: string
  forceEpisodeBreakBefore: boolean
  forceShotBreakBefore?: boolean
}

export function splitScriptParagraphs(script: string): ScriptParagraph[] {
  const lines = scriptBodyWithoutAssetManifest(script)
    .replaceAll(FORCE_EPISODE_BREAK_MARKER, `\n${FORCE_EPISODE_BREAK_MARKER}\n`)
    .replaceAll(FORCE_SHOT_BREAK_MARKER, `\n${FORCE_SHOT_BREAK_MARKER}\n`)
    .replace(/(?:｜|\|)\s*(?=(?:#{1,6}\s*|\*{1,2})?场次\s*[：:])/gu, '\n')
    .split(/\n+/)
    .map(normalizeScriptLine)
    .filter(Boolean)
  const paragraphs: ScriptParagraph[] = []
  let forceEpisodeBreakBefore = false
  let forceShotBreakBefore = false
  let structuredScene: ScriptParagraph | null = null

  const flushStructuredScene = () => {
    if (!structuredScene) return
    paragraphs.push(structuredScene)
    structuredScene = null
  }

  for (const line of lines) {
    if (line === FORCE_EPISODE_BREAK_MARKER) {
      flushStructuredScene()
      forceEpisodeBreakBefore = true
      continue
    }
    if (line === FORCE_SHOT_BREAK_MARKER) {
      flushStructuredScene()
      forceShotBreakBefore = true
      continue
    }

    if (isEpisodeHeaderLine(line)) {
      flushStructuredScene()
      forceEpisodeBreakBefore = true
      continue
    }

    if (isSceneHeaderLine(line)) {
      flushStructuredScene()
      structuredScene = {
        text: line,
        forceEpisodeBreakBefore,
        ...(forceShotBreakBefore ? { forceShotBreakBefore: true } : {}),
      }
      forceEpisodeBreakBefore = false
      forceShotBreakBefore = false
      continue
    }

    if (structuredScene && isStructuredSceneContinuation(line)) {
      structuredScene.text = `${structuredScene.text}｜${line}`
      continue
    }

    if (structuredScene) {
      structuredScene.text = `${structuredScene.text} ${line}`
      continue
    }

    flushStructuredScene()
    paragraphs.push({
      text: line,
      forceEpisodeBreakBefore,
      ...(forceShotBreakBefore ? { forceShotBreakBefore: true } : {}),
    })
    forceEpisodeBreakBefore = false
    forceShotBreakBefore = false
  }

  flushStructuredScene()

  return paragraphs
}

export function scriptBodyWithoutAssetManifest(script: string): string {
  if (!/(?:^|\n)\s*资产\s*[：:]/u.test(script)) return script
  return script
    .replace(
      /(?:^|\n)\s*资产\s*[：:][\s\S]*?(?=(?:^|\n)\s*(?:(?:正文|剧本正文|正文内容)\s*[：:]|场次\s*[：:]))/gmu,
      '\n',
    )
    .replace(/(?:^|\n)\s*(?:正文|剧本正文|正文内容)\s*[：:]\s*/gmu, '\n')
    .trim()
}

function scriptAssetManifestPrefix(script: string): string {
  const body = scriptBodyWithoutAssetManifest(script)
  if (body === script) return ''
  const bodyIndex = script.indexOf(body)
  return bodyIndex > 0 ? script.slice(0, bodyIndex).trim() : ''
}

function normalizeScriptLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/u, '')
    .replace(/^[-+>]\s+(?=(?:\*{1,2})?(?:场次|场景|第\s*\d+\s*[集话场幕]|(?:E\d+[-_])?S\d+))/iu, '')
    .trim()
}

function normalizedScriptHeader(line: string): string {
  return normalizeScriptLine(line)
    .replace(/[*_`【】[\]]/gu, '')
    .trim()
}

function isEpisodeHeaderLine(line: string): boolean {
  const header = normalizedScriptHeader(line)
  if (/^E\d+[-_]S\d+/iu.test(header)) return false
  return /^(?:第\s*[一二三四五六七八九十百千0-9]+\s*[集话]|EP(?:ISODE)?\s*\d+)(?:\s*[：:].*)?$/iu.test(header)
}

function isSceneHeaderLine(line: string): boolean {
  const header = normalizedScriptHeader(line)
  return /^(?:场次\s*(?:[：:]\s*)?(?:[A-Z]*\d+|[一二三四五六七八九十百千]+)|(?:E\d+[-_])?S\d+|第\s*[一二三四五六七八九十百千0-9]+\s*[场幕]|(?:场景|SCENE)\s*[一二三四五六七八九十百千0-9]+)(?:\s*[：:｜|.、-].*)?$/iu.test(
    header,
  )
}

function isStructuredSceneContinuation(line: string): boolean {
  const field = line
    .match(/^([^：:]{1,20})\s*[：:]/u)?.[1]
    ?.replace(/[*_`#【】[\]]/gu, '')
    .trim()
  return Boolean(
    field && ([...SHOT_FIELD_NAMES, ...SCENE_DIRECTION_FIELD_NAMES] as readonly string[]).includes(field),
  )
}

const LONG_SCRIPT_PARAGRAPH_THRESHOLD = 900
const LONG_SCRIPT_CHUNK_TARGET = 420

export function expandLongScriptParagraphs(paragraphs: ScriptParagraph[]): ScriptParagraph[] {
  return paragraphs.flatMap(expandLongScriptParagraph)
}

function expandLongScriptParagraph(paragraph: ScriptParagraph): ScriptParagraph[] {
  if (paragraph.text.replace(/\s/gu, '').length < LONG_SCRIPT_PARAGRAPH_THRESHOLD) return [paragraph]

  const fields = parseShotFields(paragraph.text)
  if (fields.场次 && (fields.镜头1 || fields.镜头2 || fields.镜头3)) return [paragraph]
  const direction = parseSceneDirectionFields(paragraph.text)
  const narrativeField = (['动作', '剧情', '对白'] as const)
    .map((field) => ({ field, value: fields[field]?.trim() || '' }))
    .sort((left, right) => right.value.length - left.value.length)[0]
  const narrative =
    narrativeField && narrativeField.value.length >= LONG_SCRIPT_PARAGRAPH_THRESHOLD / 2
      ? narrativeField.value
      : paragraph.text
  const chunks = splitLongNarrative(narrative)
  if (chunks.length < 2) return [paragraph]

  const structured = Boolean(fields.场次) && narrative !== paragraph.text && narrativeField
  return chunks.map((chunk, index) => {
    if (!structured || !narrativeField) {
      return {
        text: chunk,
        forceEpisodeBreakBefore: index === 0 && paragraph.forceEpisodeBreakBefore,
        ...(index === 0 && paragraph.forceShotBreakBefore ? { forceShotBreakBefore: true } : {}),
      }
    }

    const sceneNumber = `${fields.场次}-${String(index + 1).padStart(2, '0')}`
    const row = [
      `场次：${sceneNumber}`,
      `${narrativeField.field}：${chunk}`,
      ...SHOT_FIELD_NAMES.filter(
        (field) =>
          field !== '场次' &&
          field !== narrativeField.field &&
          Boolean(fields[field]) &&
          (fields[field]?.length || 0) <= 600,
      ).map((field) => `${field}：${fields[field]}`),
      ...SCENE_DIRECTION_FIELD_NAMES.filter((field) => Boolean(direction[field])).map(
        (field) => `${field}：${direction[field]}`,
      ),
    ].join('｜')

    return {
      text: row,
      forceEpisodeBreakBefore: index === 0 && paragraph.forceEpisodeBreakBefore,
      ...(index === 0 && paragraph.forceShotBreakBefore ? { forceShotBreakBefore: true } : {}),
    }
  })
}

function splitLongNarrative(value: string): string[] {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (!normalized) return []
  const sentences = normalized.match(/[^。！？!?；;]+[。！？!?；;]?/gu) || [normalized]
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    const text = current.trim()
    if (text) chunks.push(text)
    current = ''
  }

  for (const sentence of sentences) {
    const text = sentence.trim()
    if (!text) continue
    if (text.length > LONG_SCRIPT_CHUNK_TARGET * 1.5) {
      flush()
      for (let offset = 0; offset < text.length; offset += LONG_SCRIPT_CHUNK_TARGET) {
        chunks.push(text.slice(offset, offset + LONG_SCRIPT_CHUNK_TARGET).trim())
      }
      continue
    }
    if (current && current.length + text.length > LONG_SCRIPT_CHUNK_TARGET) flush()
    current += text
  }
  flush()
  return chunks
}

export function preserveScriptBreakMarkers(source: string, candidate: string): string {
  const sourceParagraphs = splitScriptParagraphs(source)
  const sourceEpisodeBreaks = new Set(
    sourceParagraphs.flatMap((paragraph, index) => (paragraph.forceEpisodeBreakBefore ? [index] : [])),
  )
  const sourceShotBreaks = new Set(
    sourceParagraphs.flatMap((paragraph, index) => (paragraph.forceShotBreakBefore ? [index] : [])),
  )
  if (!sourceEpisodeBreaks.size && !sourceShotBreaks.size) return candidate

  return splitScriptParagraphs(candidate)
    .flatMap((paragraph, index) => [
      ...(sourceEpisodeBreaks.has(index) || paragraph.forceEpisodeBreakBefore
        ? [FORCE_EPISODE_BREAK_MARKER]
        : []),
      ...(sourceShotBreaks.has(index) || paragraph.forceShotBreakBefore ? [FORCE_SHOT_BREAK_MARKER] : []),
      paragraph.text,
    ])
    .join('\n')
}

export function hasStructuredSceneRows(script: string): boolean {
  const paragraphs = splitScriptParagraphs(script)
  if (paragraphs.length < 2) return false
  const structuredRows = paragraphs.filter((paragraph) => {
    const fields = parseShotFields(paragraph.text)
    return Boolean(fields.场次) && Object.keys(fields).length >= 3
  }).length
  return structuredRows >= Math.max(2, Math.ceil(paragraphs.length * 0.6))
}

export function alignEnrichedSceneRows(source: string, candidate: string): string {
  const sourceParagraphs = splitScriptParagraphs(source)
  const candidateParagraphs = splitScriptParagraphs(candidate)
  if (!sourceParagraphs.length || !candidateParagraphs.length) return candidate

  const candidateFields = candidateParagraphs.map((paragraph) => parseShotFields(paragraph.text))
  const preserveSceneCount = hasStructuredSceneRows(source)
  const isComplete =
    (!preserveSceneCount || candidateParagraphs.length === sourceParagraphs.length) &&
    candidateFields.every((fields) => COMPLETE_SCENE_FIELDS.every((field) => Boolean(fields[field])))
  if (isComplete) return candidate

  const sourceFields = sourceParagraphs.map((paragraph) => parseShotFields(paragraph.text))
  const candidateByScene = new Map(
    candidateFields
      .map((fields, index) => [sceneNumberKey(fields.场次, index), fields] as const)
      .filter(([key]) => key),
  )

  const alignedBody = sourceParagraphs
    .map((paragraph, index) => {
      const original = sourceFields[index] || {}
      const generated =
        candidateByScene.get(sceneNumberKey(original.场次, index)) || candidateFields[index] || {}
      const merged = {
        场次: generated.场次 || original.场次 || `S${String(index + 1).padStart(2, '0')}`,
        剧情: generated.剧情 || original.剧情 || '本场继续推进当前冲突，并产生明确变化。',
        场景: generated.场景 || original.场景 || '沿用上一场空间与时间',
        角色: generated.角色 || original.角色 || '沿用上一场角色；无配角，环境保持静态',
        动作:
          generated.动作 ||
          original.动作 ||
          '动作1：角色保持上一场结束姿态并确认目标；动作2：角色根据阻力改变位置或视线；动作3：角色停在下一步行动前。',
        对白: generated.对白 || original.对白 || '无台词，角色通过表情和动作传达变化',
        风格: generated.风格 || original.风格 || '沿用项目视觉风格，角色和场景材质保持统一',
        构图: generated.构图 || original.构图 || '中景，主体位于画面重心，前中后景关系清晰',
        光影: generated.光影 || original.光影 || '沿用上一场光源方向和色温，避免跳变',
        运镜: generated.运镜 || original.运镜 || '稳定跟随动作，结尾停在下一动作的起始位置',
        衔接:
          generated.衔接 ||
          original.衔接 ||
          '承接上一场最后人物位置、视线、动作、服装、物件和光线；本场结尾为下一场留下动作接点',
      }
      const row = COMPLETE_SCENE_FIELDS.map((field) => `${field}：${merged[field]}`).join('｜')
      return [
        paragraph.forceEpisodeBreakBefore ? FORCE_EPISODE_BREAK_MARKER : '',
        paragraph.forceShotBreakBefore ? FORCE_SHOT_BREAK_MARKER : '',
        row,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')
  const manifestPrefix = scriptAssetManifestPrefix(candidate)
  return manifestPrefix ? `${manifestPrefix}\n${alignedBody}` : alignedBody
}

function sceneNumberKey(value: string | undefined, index: number): string {
  const text = String(value || '').trim()
  const match = text.match(/(?:S|场次\s*)?(\d+)/iu)
  return match?.[1] ? String(Number(match[1])) : String(index + 1)
}

export function scriptScenes(script: string): string[] {
  return splitScriptParagraphs(script).map((paragraph) => paragraph.text)
}

export function countStructuredScenes(script: string): number {
  return splitScriptParagraphs(script).filter((paragraph) => Boolean(parseShotFields(paragraph.text).场次))
    .length
}

const SHOT_FIELD_NAMES = [
  '场次',
  '时长',
  '剧情',
  '场景',
  '角色',
  '服装',
  '关键物件',
  '动作',
  '对白',
  '声音',
  '风格',
  '构图',
  '光影',
  '运镜',
  '镜头1',
  '镜头2',
  '镜头3',
  '衔接',
] as const

const SCENE_DIRECTION_FIELD_NAMES = ['目标', '阻力', '变化', '入场状态', '出场状态'] as const
export type SceneDirectionFields = Partial<Record<(typeof SCENE_DIRECTION_FIELD_NAMES)[number], string>>

export type ShotDraft = Omit<
  CreateShot,
  'scriptEpisodeId' | 'episodeNumber' | 'episodeTitle' | 'episodeKind'
> & {
  episodeKind?: 'standard' | 'hook'
}

export function splitScriptIntoBeatShots(
  paragraphs: ScriptParagraph[],
  maxShots: number,
  isWebSeries = false,
): ShotDraft[] {
  const shots: ShotDraft[] = []
  for (const [sceneIndex, scriptParagraph] of paragraphs.entries()) {
    const paragraph = scriptParagraph.text
    const fields = parseShotFields(paragraph)
    const direction = parseSceneDirectionFields(paragraph)
    const beats = splitFieldBeats(fields.动作 || fields.剧情 || paragraph).slice(0, 4)
    const dialogueBeats = spokenDialogueCues(fields.对白)
    const soundCues = nonSpokenSoundCues(fields.对白)
    const sceneNumber = fields.场次 || String(sceneIndex + 1)
    const previousParagraph = paragraphs[sceneIndex - 1]
    const continuesPreviousScene =
      sceneIndex > 0 &&
      !scriptParagraph.forceShotBreakBefore &&
      scenesShareVisualContinuity(previousParagraph?.text || '', paragraph)
    for (const [beatIndex, beat] of beats.entries()) {
      if (shots.length >= maxShots) return shots
      const spokenDialogue =
        dialogueBeats.length > 1
          ? dialogueBeats[beatIndex] || ''
          : beatIndex === 0
            ? dialogueBeats[0] || ''
            : ''
      const dialogue = [spokenDialogue, beatIndex === 0 ? soundCues.join('；') : '']
        .filter(Boolean)
        .join('；')
      const duration = estimateShotDuration(beat, dialogue, fields, isWebSeries)
      const previousSource =
        beatIndex > 0
          ? continuitySource(fields, direction, beats[beatIndex - 1] || '')
          : previousParagraph?.text || ''
      const currentSource = continuitySource(fields, direction, beat)
      shots.push({
        title: `场次 ${sceneNumber} · 动作 ${beatIndex + 1}`,
        framing: beatFraming(fields.构图, beat, dialogue, beatIndex, beats.length),
        duration,
        prompt: compactShotPrompt(fields, direction, beat, dialogue, duration, beatIndex, beats.length),
        negativePrompt: '',
        imageUrl: null,
        episodeBreakBefore: beatIndex === 0 && scriptParagraph.forceEpisodeBreakBefore,
        episodeKind: isHookParagraph(paragraph) && beatIndex === beats.length - 1 ? 'hook' : 'standard',
        continuityMode:
          shots.length === 0 || (beatIndex === 0 && !continuesPreviousScene) ? 'independent' : 'continue',
        continuityNote: continuityNoteFor(previousSource, beatIndex > 0 ? '上一镜' : '上一场', {
          entryState: beatIndex === 0 ? direction.入场状态 : undefined,
          exitState: beatIndex === beats.length - 1 ? direction.出场状态 : undefined,
          current: currentSource,
          visualContinuity: beatIndex > 0 || continuesPreviousScene,
        }),
      })
    }
  }
  return shots
}

export function splitScriptIntoSceneShots(
  paragraphs: ScriptParagraph[],
  maxShots: number,
  isWebSeries = false,
): ShotDraft[] {
  return paragraphs.slice(0, maxShots).map((scriptParagraph, index) => {
    const paragraph = scriptParagraph.text
    const fields = parseShotFields(paragraph)
    const direction = parseSceneDirectionFields(paragraph)
    const structured = Object.keys(fields).length > 1
    const previousParagraph = paragraphs[index - 1]
    const continuesPreviousScene =
      index > 0 &&
      !scriptParagraph.forceShotBreakBefore &&
      scenesShareVisualContinuity(previousParagraph?.text || '', paragraph)
    return {
      title: `镜头 ${String(index + 1).padStart(2, '0')}`,
      framing: sceneFraming(fields, index),
      duration: structured
        ? estimateShotDuration(fields.动作 || fields.剧情 || paragraph, fields.对白, fields, isWebSeries)
        : Math.min(15, Math.max(isWebSeries ? 3 : 4, Math.ceil(paragraph.length / 18))),
      prompt: structured
        ? compactShotPrompt(
            fields,
            direction,
            fields.动作 || fields.剧情 || paragraph,
            fields.对白,
            undefined,
            0,
            1,
            'scene',
          )
        : paragraph,
      negativePrompt: '',
      imageUrl: null,
      episodeBreakBefore: scriptParagraph.forceEpisodeBreakBefore,
      episodeKind: isHookParagraph(paragraph) ? ('hook' as const) : ('standard' as const),
      continuityMode:
        index === 0 || !continuesPreviousScene ? ('independent' as const) : ('continue' as const),
      continuityNote: continuityNoteFor(previousParagraph?.text || '', '上一场', {
        entryState: direction.入场状态,
        exitState: direction.出场状态,
        current: paragraph,
        visualContinuity: continuesPreviousScene,
      }),
    }
  })
}

export function isHookParagraph(paragraph: string): boolean {
  const fields = parseShotFields(paragraph)
  return /剧情钩子|悬念钩子|结尾钩子/u.test(fields.场次 || '') || /^【?剧情钩子】?/u.test(paragraph)
}

export function continuityNoteFor(
  previous: string,
  previousLabel: '上一场' | '上一镜',
  sceneState: {
    entryState?: string | undefined
    exitState?: string | undefined
    current?: string | undefined
    visualContinuity?: boolean | undefined
  } = {},
): string {
  if (!previous.trim()) return ''
  const previousDirection = parseSceneDirectionFields(previous)
  const previousFields = parseShotFields(previous)
  const currentFields = parseShotFields(sceneState.current || '')
  const previousAction = previousFields.动作 || previousFields.剧情 || previous
  const currentAction = currentFields.动作 || currentFields.剧情 || sceneState.current || ''
  return [
    sceneState.visualContinuity
      ? `${previousLabel}已完成；首帧直接承接该镜真实尾帧，不得重演、解释或复述上一镜已经完成的事件。`
      : `${previousLabel}已完成；本镜使用独立首帧，只承接剧情状态，不携带上一场画面构图。`,
    `上一镜终态：${[
      previousFields.场景 ? `场景在${headExcerpt(previousFields.场景, 100)}` : '',
      previousFields.角色 ? `人物为${headExcerpt(previousFields.角色, 140)}` : '',
      previousAction ? `已完成${tailExcerpt(previousAction, 180)}` : '',
      previousDirection.出场状态 ? `形成${tailExcerpt(previousDirection.出场状态, 180)}` : '',
    ]
      .filter(Boolean)
      .join('；')}`,
    `本镜动作起点：${[
      currentFields.场景 ? `场景为${headExcerpt(currentFields.场景, 100)}` : '',
      currentFields.角色 ? `画内人物为${headExcerpt(currentFields.角色, 140)}` : '',
      sceneState.entryState ? headExcerpt(sceneState.entryState, 180) : '',
      currentAction ? `随后只执行${headExcerpt(currentAction, 180)}` : '',
    ]
      .filter(Boolean)
      .join('；')}`,
    sceneState.visualContinuity
      ? '人物位置、视线、动作方向、服装、关键物品和光线保持连续；本镜直接执行自己的主动作。'
      : '人物身份、服装和关键物品归属保持连续；人物位置、构图与光线按本镜新场景重新建立。',
    '本镜结束时保留清晰的结束姿态、视线落点和物件状态，供下一镜真实尾帧直接承接。',
    sceneState.exitState ? `本镜所在场次的最终出场状态：${tailExcerpt(sceneState.exitState, 220)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function continuitySource(
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  direction: SceneDirectionFields,
  action: string,
): string {
  return [
    fieldPart('场景', fields.场景, 320),
    fieldPart('角色', fields.角色, 420),
    fieldPart('动作', action, 520),
    fieldPart('入场状态', direction.入场状态, 240),
    fieldPart('出场状态', direction.出场状态, 240),
  ]
    .filter(Boolean)
    .join('｜')
}

export function scenesShareVisualContinuity(previous: string, current: string): boolean {
  if (!previous.trim() || !current.trim()) return false
  const previousScene = parseShotFields(previous).场景 || ''
  const currentScene = parseShotFields(current).场景 || ''
  if (/^(?:沿用|承接|继续)(?:上一场|上场|前场)/u.test(currentScene.trim())) return true
  if (!previousScene.trim() && !currentScene.trim()) return true
  if (!previousScene.trim() || !currentScene.trim()) return false
  const previousMoment = sceneMoment(previousScene)
  const currentMoment = sceneMoment(currentScene)
  if (previousMoment && currentMoment && previousMoment !== currentMoment) return false
  const previousIdentity = normalizedSceneIdentity(previousScene)
  const currentIdentity = normalizedSceneIdentity(currentScene)
  if (!previousIdentity || !currentIdentity) return false
  return (
    previousIdentity === currentIdentity ||
    (Math.min(previousIdentity.length, currentIdentity.length) >= 4 &&
      (previousIdentity.includes(currentIdentity) || currentIdentity.includes(previousIdentity)))
  )
}

function sceneMoment(value: string): 'dawn' | 'day' | 'sunset' | 'night' | '' {
  if (/清晨|黎明|拂晓|日出/u.test(value)) return 'dawn'
  if (/黄昏|傍晚|日落/u.test(value)) return 'sunset'
  if (/深夜|夜晚|夜间|雨夜|雪夜|午夜/u.test(value)) return 'night'
  if (/白天|上午|中午|下午|日间/u.test(value)) return 'day'
  return ''
}

export function normalizedSceneIdentity(value: string): string {
  return value
    .split(/[，,；;。]/u)[0]!
    .replace(/(?:清晨|早晨|上午|中午|下午|傍晚|黄昏|深夜|夜晚|夜间|白天|雨天|雪天|晴天|雾天)/gu, '')
    .replace(/[\s·|｜()（）【】\-—]/gu, '')
    .trim()
}

export function episodeOpeningContinuityNote(
  previousEpisode: ScriptEpisode | undefined,
  episode: ScriptEpisode,
  shotContinuityNote: string,
): string {
  if (!previousEpisode) return shotContinuityNote
  const previousState = Object.keys(previousEpisode.continuityState || {}).length
    ? JSON.stringify(previousEpisode.continuityState)
    : previousEpisode.summary || previousEpisode.content.replace(/\s+/gu, ' ').slice(-500)
  return [
    `剧集边界：第 ${episode.episodeNumber} 集使用独立首帧，不得读取上一集尾帧作为视觉参考。`,
    `上一集剧情终态：${tailExcerpt(previousState, 500)}`,
    '只承接人物关系、已知信息、情绪和关键物品归属；当前镜头的场景、时间、人物位置与动作以本集开场分镜为准。',
    shotContinuityNote,
  ]
    .filter(Boolean)
    .join('\n')
}

function tailExcerpt(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : normalized.slice(-limit)
}

export function headExcerpt(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= limit ? normalized : normalized.slice(0, limit)
}

export function parseShotFields(
  paragraph: string,
): Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>> {
  const fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>> = {}
  for (const segment of paragraph.split('｜')) {
    const match = segment
      .trim()
      .replace(/^\*{1,2}|\*{1,2}$/gu, '')
      .match(/^([^：:]+)[：:]([\s\S]*)$/)
    const key = match?.[1]?.replace(/[*_`#【】[\]]/gu, '').trim() as
      (typeof SHOT_FIELD_NAMES)[number] | undefined
    if (key && SHOT_FIELD_NAMES.includes(key)) {
      fields[key] = match?.[2]?.replace(/^\*{1,2}|\*{1,2}$/gu, '').trim() || ''
    }
  }
  return fields
}

export function parseSceneDirectionFields(paragraph: string): SceneDirectionFields {
  const fields: SceneDirectionFields = {}
  for (const segment of paragraph.split('｜')) {
    const match = segment
      .trim()
      .replace(/^\*{1,2}|\*{1,2}$/gu, '')
      .match(/^([^：:]+)[：:]([\s\S]*)$/)
    const key = match?.[1]?.replace(/[*_`#【】[\]]/gu, '').trim() as
      (typeof SCENE_DIRECTION_FIELD_NAMES)[number] | undefined
    if (key && SCENE_DIRECTION_FIELD_NAMES.includes(key)) {
      fields[key] = match?.[2]?.replace(/^\*{1,2}|\*{1,2}$/gu, '').trim() || ''
    }
  }
  return fields
}

export function splitFieldBeats(value: string, splitCommas = false): string[] {
  const text = value.trim()
  if (!text) return []
  const explicitActionBeats = text
    .split(/(?=动作\s*[1-9][0-9]*\s*[：:])/u)
    .map((item) => item.trim())
    .filter(Boolean)
  // `动作1/动作2` is the production contract. Commas inside one labelled action
  // describe its performance details and must never create extra video shots.
  if (explicitActionBeats.some((item) => /^动作\s*[1-9][0-9]*\s*[：:]/u.test(item))) {
    return explicitActionBeats
  }
  const semicolonBeats = text
    .split(
      splitCommas ? /[；;，,]+|(?=动作\s*[1-9][0-9]*\s*[：:])/u : /[；;]+|(?=动作\s*[1-9][0-9]*\s*[：:])/u,
    )
    .map((item) => item.trim())
    .filter(Boolean)
  if (semicolonBeats.length > 1) return semicolonBeats
  return text
    .split(/(?<=[。！？!?])/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function spokenDialogueCues(value: string | undefined): string[] {
  const text = String(value || '').trim()
  if (!text) return []
  const tagged = splitTaggedAudioCues(text).filter((cue) => /^\[(?:对白|台词|画外音|内心独白)\]/u.test(cue))
  if (tagged.length) return tagged
  return splitFieldBeats(text).filter(
    (cue) => !/无台词|静音|^\[(?:音效|环境声|音乐|音乐\/环境声)\]/u.test(cue),
  )
}

export function nonSpokenSoundCues(value: string | undefined): string[] {
  return splitTaggedAudioCues(String(value || '')).filter((cue) =>
    /^\[(?:音效|环境声|音乐|音乐\/环境声)\]/u.test(cue),
  )
}

function splitTaggedAudioCues(value: string): string[] {
  return value
    .split(/(?=\[(?:对白|台词|画外音|内心独白|音效|环境声|音乐|音乐\/环境声)\])/u)
    .map((cue) => cue.trim().replace(/^[；;]+|[；;]+$/gu, ''))
    .filter(Boolean)
}

function compactShotPrompt(
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  direction: SceneDirectionFields,
  beat: string,
  dialogue?: string,
  duration?: number,
  beatIndex = 0,
  beatCount = 1,
  scope: 'scene' | 'beat' = 'beat',
): string {
  const action = beat.trim() || fields.动作 || '角色保持当前状态并产生可见变化'
  const resolvedDialogue =
    dialogue === undefined
      ? fields.对白 || '无台词，角色通过表情和动作传达变化'
      : dialogue || '无台词，仅保留本镜动作声、环境声和画内人物反应'
  return [
    fieldPart('场次', fields.场次 || '未编号场次', 24),
    fieldPart('剧情', fields.剧情 || '本场继续推进当前冲突', 260),
    fieldPart('目标', direction.目标 || '角色完成当前可见行动', 180),
    fieldPart('阻力', direction.阻力 || '当前环境或对手阻碍角色推进', 180),
    fieldPart('变化', direction.变化 || '动作结束后角色状态发生可见变化', 180),
    fieldPart('场景', fields.场景 || '沿用上一场空间与时间', 320),
    fieldPart('角色', fields.角色 || '沿用上一场所有角色；每位画面内人物都必须有动作、表情或视线变化', 420),
    ...(beatIndex === 0 ? [fieldPart('入场状态', direction.入场状态, 240)] : []),
    fieldPart(
      '镜头边界',
      scope === 'scene'
        ? '本镜只覆盖当前场次，按动作字段顺序完成，不重演上一场，不提前进入下一场'
        : '本镜只表现当前动作，不重演上一镜已完成动作，不提前执行本场后续动作',
      160,
    ),
    fieldPart('动作', action, 520),
    fieldPart('对白', resolvedDialogue, 280),
    fieldPart('风格', fields.风格 || '沿用项目视觉风格，角色与场景材质统一', 180),
    fieldPart('构图', fields.构图 || '中景，主体位于画面重心，前中后景清晰', 220),
    fieldPart('光影', fields.光影 || '沿用上一场光源方向和色温，避免跳变', 200),
    fieldPart('运镜', fields.运镜 || '稳定跟随动作，结尾停在下一动作起点', 240),
    fieldPart('衔接', fields.衔接 || '承接上一场人物位置、视线、动作、服装、物件和光线状态', 300),
    ...(beatIndex === beatCount - 1 ? [fieldPart('出场状态', direction.出场状态, 240)] : []),
    fieldPart('导演节拍', directorBeatFor(action, fields.角色, resolvedDialogue, duration, scope), 480),
  ]
    .filter(Boolean)
    .join('｜')
}

function estimateShotDuration(
  beat: string,
  dialogue: string | undefined,
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  isWebSeries: boolean,
): number {
  const action = String(beat || fields.动作 || fields.剧情 || '').trim()
  const spokenCharacters = dialogueTextForTiming(dialogue).length
  const dialogueSeconds = spokenCharacters ? Math.ceil(spokenCharacters / 4) + 1 : 0
  const reactionOnly =
    /(?:抬眼|抬头|回头|转头|对视|凝视|停住|停步|皱眉|屏住呼吸|吸气|惊愕|错愕|警觉|眼神)/u.test(action) &&
    !/(?:走|跑|冲|进入|离开|打开|关上|拿起|放下|递|接|抓|推|拉|击|躲|拥抱|贴近|划过|投出|操作|按住|伸手|抬手|举起|拨开|握住)/u.test(
      action,
    )
  const movementOrInteraction =
    /(?:走|跑|冲|进入|离开|打开|关上|拿起|放下|递|接|抓|推|拉|击|躲|转身|跪|起身|坐下|贴近|划过|投出|操作|按住|伸手|抬手|举起|拨开|握住)/u.test(
      action,
    )
  const actionSeconds = reactionOnly ? 3 : movementOrInteraction ? 5 : 4
  const baseDuration = Math.max(actionSeconds, dialogueSeconds)

  // 网剧允许少量 3 秒反应镜，其余镜头至少留出一个完整动作和一次表情变化。
  const minimum = isWebSeries && reactionOnly && !dialogueSeconds ? 3 : 4
  return Math.min(15, Math.max(minimum, baseDuration || minimum))
}

export function dialogueTextForTiming(dialogue: string | undefined): string {
  const source = String(dialogue || '')
  const spokenCues = spokenDialogueCues(source)
  return (spokenCues.length ? spokenCues.join('；') : source)
    .replace(/\[(?:对白|台词|画外音|内心独白)\]/gu, '')
    .replace(/(?:^|[；;])[^：:\n]{1,16}[：:]/gu, '')
    .replace(/\[(?:音效|环境声|音乐|音乐\/环境声)\][^；;]*/gu, '')
    .replace(/[\s，。！？、；;“”"'（）()——-]/gu, '')
    .trim()
}

function directorBeatFor(
  action: string,
  roleField: string | undefined,
  dialogue: string | undefined,
  duration: number | undefined,
  scope: 'scene' | 'beat' = 'beat',
): string {
  const roles = namedRolesForDirector(roleField)
  const lead = roles[0] || '主角'
  const supporting = roles.slice(1).join('、')
  const hasDialogue = dialogueTextForTiming(dialogue).length > 0 && !/无台词/u.test(String(dialogue || ''))
  const endSecond = Math.max(2, Number(duration || 4) - 1)
  return [
    scope === 'scene'
      ? `本镜完整表现当前场次，不新增场外事件：${headExcerpt(action, 180)}`
      : `本镜只完成一个主动作：${headExcerpt(action, 180)}`,
    scope === 'scene'
      ? `0-1 秒承接入场状态，1-${endSecond} 秒按动作字段的既定顺序完成表演与反应，最后 1 秒固定人物位置、视线和物件状态`
      : `0-1 秒承接既有状态，1-${endSecond} 秒完整表现动作起势、执行与一次表情或视线变化，最后 1 秒停在可被下一镜承接的结束姿态`,
    supporting
      ? `主角 ${lead} 推进主动作；配角 ${supporting} 只做同步的转头、视线、停步或姿态反应，不新增第二个剧情动作`
      : `主角 ${lead} 推进主动作；其他画内人物只做同步的视线、表情或姿态反应，不新增第二个剧情动作`,
    hasDialogue
      ? '对白在动作进行中自然说完，口型与听者反应同步，不为念完长台词而另起动作'
      : '无对白时用表情、视线、环境声和动作音效推进信息，不留空镜填时长',
  ].join('；')
}

function namedRolesForDirector(roleField: string | undefined): string[] {
  const raw = String(roleField || '').trim()
  if (!raw) return []
  const profiledRoles = [...raw.matchAll(/(?:^|[；;])\s*([^（(；;]{1,40})[（(]/gu)]
    .map((match) => match[1]?.trim())
    .filter((name): name is string => Boolean(name))
  if (profiledRoles.length) return profiledRoles
  return raw
    .split(/[；;]/u)
    .flatMap((role) => (role.split(/[，,]/u)[0] || '').split('、'))
    .map((role) => role.replace(/[（(].*$/u, '').trim())
    .filter(Boolean)
}

export function fieldPart(label: string, value: string | undefined, limit: number): string {
  const text = String(value || '').trim()
  return text ? `${label}：${text.slice(0, limit)}` : ''
}

function beatFraming(
  composition: string | undefined,
  beat: string,
  dialogue: string | undefined,
  beatIndex: number,
  beatCount: number,
): string {
  const explicit = ['大全景', '全景', '广角', '俯拍', '中景', '中近景', '近景', '特写'].find((framing) =>
    composition?.includes(framing),
  )
  if (beatIndex === 0) {
    return explicit || (/走|跑|冲|进入|离开|战斗|追逐/u.test(beat) ? '全景' : '大全景')
  }
  if (/看清|发现|信封|手机|屏幕|戒指|钥匙|照片|证据|按钮|伤口/u.test(beat)) return '特写'
  if (dialogueTextForTiming(dialogue).length || /表情|眼神|皱眉|流泪|惊愕|错愕|警觉/u.test(beat)) {
    return beatIndex === beatCount - 1 ? '特写' : '近景'
  }
  if (/走|跑|冲|进入|离开|打|击|躲|转身|起身|坐下|拥抱|推|拉/u.test(beat)) return '中景'
  if (beatIndex === beatCount - 1) return '近景'
  return '中景'
}

function sceneFraming(
  fields: Partial<Record<(typeof SHOT_FIELD_NAMES)[number], string>>,
  index: number,
): string {
  const action = fields.动作 || fields.剧情 || ''
  const explicit = ['大全景', '全景', '广角', '俯拍', '中景', '中近景', '近景', '特写'].find((framing) =>
    fields.构图?.includes(framing),
  )
  if (explicit) return explicit
  if (/看清|发现|信封|手机|屏幕|戒指|钥匙|照片|证据|按钮|伤口/u.test(action)) return '特写'
  if (fields.对白 || /表情|眼神|皱眉|流泪|惊愕|错愕|警觉/u.test(action)) return '中近景'
  if (/走|跑|冲|进入|离开|战斗|追逐|人群|全貌/u.test(action)) return '全景'
  return index === 0 ? '大全景' : '中景'
}
