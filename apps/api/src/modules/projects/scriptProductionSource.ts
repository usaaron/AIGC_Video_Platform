import { createHash } from 'node:crypto'
import { scriptAssetEvidenceSchema } from '@seqora/contracts'
import {
  expandLongScriptParagraphs,
  parseShotFields,
  splitScriptParagraphs,
  type ScriptParagraph,
} from './shotPlanning.js'
import { scriptMasterSceneHeadings } from './scriptMasterScreenplay.js'

/**
 * Prepare saved production prose once. Scene appearances are usable only when
 * their exact-text hash and the complete ordered export headings both agree.
 * Older or edited deliveries retain the established text parser.
 */
export function prepareScriptProductionParagraphs(
  content: string,
  assetEvidence?: unknown,
): ScriptParagraph[] {
  const paragraphs = splitScriptParagraphs(content)
  const parsed = scriptAssetEvidenceSchema.safeParse(assetEvidence)
  if (!parsed.success) return expandLongScriptParagraphs(paragraphs)
  const evidence = parsed.data
  const scenes = evidence.scenes
  const headings = scriptMasterSceneHeadings(content)
  if (
    evidence.contentHash !== createHash('sha256').update(content.trim()).digest('hex') ||
    !scenes ||
    !headings ||
    scenes.length !== headings.length ||
    scenes.length !== paragraphs.length ||
    scenes.some((scene, index) => scene.heading !== headings[index])
  )
    return expandLongScriptParagraphs(paragraphs)
  const sceneIds = new Set(scenes.map((scene) => scene.sourceSceneId))
  if (
    sceneIds.size !== scenes.length ||
    evidence.assets.some(
      (asset) => /[\r\n｜|]/u.test(asset.name) || asset.sourceSceneIds.some((id) => !sceneIds.has(id)),
    )
  )
    return expandLongScriptParagraphs(paragraphs)

  const prepared = paragraphs.map((paragraph, index) => {
    const scene = scenes[index]!
    const original = parseShotFields(paragraph.text)
    const sourceAssets: NonNullable<ScriptParagraph['sourceAssets']> = {}
    for (const [kind, field] of [
      ['character', '角色'],
      ['scene', '场景'],
      ['prop', '关键物件'],
    ] as const) {
      const names = evidence.assets
        .filter((asset) => asset.kind === kind && asset.sourceSceneIds.includes(scene.sourceSceneId))
        .map((asset) => asset.name)
      // A partial list may refer to a subsequently edited scene. Only complete
      // categories are authoritative; missing categories keep the body parser.
      if (evidence.complete[kind]) sourceAssets[field] = names.join('、') || '无'
    }
    // Preserve time and interior/exterior information independently of the
    // reusable location name used to resolve the scene design card.
    if (
      sourceAssets.场景 &&
      sourceAssets.场景 !== '无' &&
      original.场景 &&
      original.场景 !== sourceAssets.场景
    )
      sourceAssets.场景 += `（${original.场景}）`
    return Object.keys(sourceAssets).length ? { ...paragraph, sourceAssets } : paragraph
  })
  return expandLongScriptParagraphs(prepared)
}
