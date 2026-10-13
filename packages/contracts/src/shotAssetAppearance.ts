import { characterAppearance, characterIdentity } from './assetIdentity.js'
import type { Asset } from './project.js'

type View = 'front' | 'side' | 'back' | 'face'
type ShotContext = { title?: string; prompt?: string; framing?: string }

/** Legacy design labels are not part of the actor's name. Keep stored names intact. */
export function characterReferenceName(name: string): string {
  const identity = characterIdentity(name).name
  return identity.replace(/\s+基础外观$/u, '').trim() || identity
}

function visualClauses(shot: ShotContext) {
  return `${shot.title || ''}\n${shot.prompt || ''}`
    .replace(/[“「][^”」]*[”」]|"[^"\n]*"/gu, '')
    .split(/[。；;\n｜，,]/u)
    .filter((part) => !/(对白|台词|旁白|画外音|画外声|不入画|未入画|未出场|不出场|不出现|提及|提起|谈到|谈起|照片|画像)/u.test(part))
}

export function shotMentionsVisibleCharacter(name: string, shot: ShotContext, characterNames: string[] = [name]): boolean {
  const prompt = shot.prompt || ''
  const opening = /(?:^|\n)首帧与空间调度\s*\n([\s\S]*?)(?=\n格式模式\s*(?:\n|$))/u.exec(prompt)?.[1]
  if (opening) {
    const identity = characterReferenceName(name)
    const identities = [...new Set(characterNames.map(characterReferenceName))]
    // Imported English scenes often use a unique given name in per-shot notes.
    // Never infer a short-name alias shared by two known actors.
    const given = /^([A-Za-z][A-Za-z'-]*)\s+[A-Za-z]/u.exec(identity)?.[1]
    const aliases = [identity]
    if (given && identities.filter((item) => item === given || item.startsWith(`${given} `)).length === 1) aliases.push(given)
    const namesActor = (part: string) => aliases.some((alias) => {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(/^[A-Za-z]/u.test(alias) ? `(?:^|[^A-Za-z])${escaped}(?![A-Za-z])` : escaped, 'u').test(part)
    })
    const clauses = (text: string) => text.split(/[。；;\n，,]/u)
    const absent = clauses(opening).some((part) => namesActor(part) && /(?:尚未|未|不)(?:入画|入镜|出场|出现)/u.test(part))
    const action = /(?:^|\n)动作时序\s*\n([\s\S]*?)(?=\n表演\s*(?:\n|$))/u.exec(prompt)?.[1] || ''
    const enters = clauses(action).some((part) => namesActor(part) && !/(?:尚未|未|不)(?:入画|入镜|出场|出现)/u.test(part) && /(?:入画|入镜|进入画面|走入画面|走进画面)/u.test(part))
    if (absent && !enters) return false
  }
  // A title can name an offscreen speaker; explicit shot content takes precedence.
  return visualClauses(shot.prompt?.trim() ? { prompt: shot.prompt } : shot)
    .some((part) => part.includes(characterReferenceName(name)))
}

/** Conservative textual cues, never an assertion that an image was visually verified. */
export function characterShotView(name: string, shot: ShotContext, characterNames: string[]): View | null {
  const text = `${shot.title || ''}\n${shot.prompt || ''}`
    .replace(/[“「][^”」]*[”」]|"[^"\n]*"/gu, '')
  const names = [...new Set(characterNames.map(characterReferenceName))]
  const ownName = characterReferenceName(name)
  const others = names.filter((item) => item !== ownName)
  // Do not use dialogue, negative constraints, late-shot changes or another actor's clause.
  const clauses = visualClauses(shot).filter((part) =>
    part.includes(ownName) && !others.some((other) => part.includes(other)) &&
    !/(看见|看到|想起|回忆|没有|不要|禁止|避免|并非|不(?:是|要)?(?:背|侧|正))/.test(part),
  ).map((part) => part.split(/随后|然后|接着|最后|镜尾|转身|回头/u)[0] || '')
  const cues = new Set<View>()
  for (const clause of clauses) {
    if (/背对(?:镜头|摄影机)|背面(?:视图|入镜)|背影/u.test(clause)) cues.add('back')
    if (/侧对(?:镜头|摄影机)|侧面(?:视图|入镜)|侧脸/u.test(clause)) cues.add('side')
    if (/正对(?:镜头|摄影机)|正面(?:视图|入镜)/u.test(clause)) cues.add('front')
    if (/(?:面部|脸部|眼部|头部|人脸|大头)(?:大|近)?特写/u.test(clause)) cues.add('face')
  }
  if (cues.has('back')) return cues.size === 1 ? 'back' : null
  if (cues.has('side')) return cues.size === 1 ? 'side' : null
  if (cues.has('face')) return 'face'
  const participants = names.filter((item) => text.includes(item))
  if (participants.length === 1 && participants[0] === ownName &&
      /面部|脸部|人脸|大头/u.test(shot.framing || '') && /特写|近景/u.test(shot.framing || '')) return 'face'
  return cues.has('front') ? 'front' : null
}

export function selectCharacterShotAppearance(
  asset: Pick<Asset, 'kind' | 'name' | 'attributes' | 'imageUrl'>,
  shot: ShotContext,
  characterNames: string[] = [asset.name],
) {
  if (asset.kind !== 'character' || asset.attributes.type !== 'character') return null
  const attributes = asset.attributes
  const variant = characterAppearance(asset, `${shot.title || ''}\n${shot.prompt || ''}`)
  const wanted = characterShotView(asset.name, shot, characterNames)
  const sources = variant?.turnaroundReferences || []
  // Old untagged saves historically used front/side/back order. Never guess a partially tagged set.
  const legacy = sources.length === 3 && sources.every((source) => !source.view)
  const matches = sources.filter((source, index) =>
    (source.view || (legacy ? ['front', 'side', 'back'][index] : null)) === wanted && source.url,
  )
  const face = attributes.faceReference?.url || null
  const selected = wanted !== 'face' && matches.length === 1 ? matches[0]?.url : null
  const body = variant ? variant.bodyReference?.url : attributes.bodyReference?.url
  const fronts = sources.filter((source, index) => (source.view || (legacy && index === 0 ? 'front' : null)) === 'front' && source.url)
  const front = fronts.length === 1 ? fronts[0]?.url : null
  const fallback = body || front || face || (!variant ? asset.imageUrl : null) || null
  const url = wanted === 'face' && face ? face : selected || fallback
  const view: View | 'body' | 'unspecified' = selected && wanted ? wanted : url && url === face ? 'face' : body ? 'body' : front ? 'front' : 'unspecified'
  const portrait = attributes.trustedPortrait
  const videoUrl = portrait?.status === 'active' ? `asset://${portrait.assetId}` : url
  const appearanceUrl = videoUrl !== url && view !== 'face' ? url
    : selected && face && face !== url ? face : null
  return { variant, url, videoUrl, appearanceUrl, view,
    role: videoUrl !== url ? '身份' : view === 'face' ? '面部身份' : '身份与当前造型',
    appearanceRole: videoUrl !== url ? `${view === 'body' ? '全身' : { front: '正面', side: '侧面', back: '背面', face: '面部', unspecified: '外观' }[view]}造型` : '面部身份',
    requestedView: wanted,
  }
}
