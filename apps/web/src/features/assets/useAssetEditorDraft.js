import { useState } from 'react'
import { ASSET_TABS, createDefaultAttributes } from './assetOptions'
import { buildPromptBlueprint } from './promptCompiler'

export function useAssetEditorDraft({
  asset,
  aspectRatio,
  onCreateDraft,
  onSave,
  onPersist,
  onGenerateStage,
}) {
  const kind = asset.kind
  const [draft, setDraft] = useState(() => ({
    sourceMode: asset.sourceMode || 'generate',
    name: asset.name || '',
    description: asset.description || '',
    promptMode: asset.promptMode || 'standard',
    customPromptMode: asset.customPromptMode || 'append',
    customPrompt: asset.customPrompt || '',
    negativePrompt: asset.negativePrompt || '',
    references: asset.references || [],
    attributes: asset.attributes?.type === kind ? asset.attributes : createDefaultAttributes(kind),
  }))
  const [characterStage, setCharacterStage] = useState(() => {
    if (kind !== 'character' || draft?.attributes?.faceStatus !== 'approved') return 'face'
    return draft.attributes.bodyStatus === 'approved' ? 'turnaround' : 'body'
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const stageForPrompt = kind === 'character' ? characterStage : null
  const promptBlueprint = buildPromptBlueprint(draft, aspectRatio, stageForPrompt)
  const generatedPrompt = promptBlueprint.finalPrompt
  const kindLabel = ASSET_TABS.find(([id]) => id === kind)?.[1]
  const promptBadge = promptBadgeFor(kind, characterStage, aspectRatio)

  const assetInputFor = (nextDraft, promptStage = stageForPrompt) => {
    const blueprint = buildPromptBlueprint(nextDraft, aspectRatio, promptStage)
    return {
      ...(asset.id ? {} : { kind }),
      ...nextDraft,
      prompt: blueprint.finalPrompt,
      negativePrompt: nextDraft.negativePrompt.trim() || blueprint.suggestedNegativePrompt,
      imageUrl:
        kind === 'audio'
          ? null
          : nextDraft.attributes.turnaroundReferences?.find((output) => output.view === 'front')?.url ||
            nextDraft.attributes.bodyReference?.url ||
            nextDraft.attributes.faceReference?.url ||
            nextDraft.references[0]?.url ||
            asset.imageUrl ||
            null,
      ...(asset.id ? { status: asset.status } : {}),
    }
  }

  const validateDraft = (nextDraft) => {
    if (!nextDraft.name.trim()) throw new Error('请先填写资产名称')
    if (nextDraft.sourceMode === 'import' && nextDraft.references.length === 0) {
      throw new Error('本地导入模式至少需要上传一个文件')
    }
  }

  const persistCharacterDraft = async (nextDraft, promptStage = stageForPrompt) => {
    validateDraft(nextDraft)
    const input = assetInputFor(nextDraft, promptStage)
    if (asset.id) {
      await onPersist?.(input)
      return { ...asset, ...input }
    }
    if (!onCreateDraft) throw new Error('人物草稿创建功能不可用')
    const created = await onCreateDraft(input)
    return { ...created, ...input }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    try {
      validateDraft(draft)
    } catch (validationError) {
      setError(validationError.message)
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(assetInputFor(draft))
    } catch (saveError) {
      setError(saveError.message)
      setSaving(false)
    }
  }

  const persistCharacterAttributes = async (attributes) => {
    const nextDraft = { ...draft, attributes }
    setDraft(nextDraft)
    await persistCharacterDraft(nextDraft)
  }

  const generateCharacterStage = async (stage, view = null) => {
    if (!onGenerateStage) return
    const attributes = stage === 'turnaround' ? { ...draft.attributes, turnaround: true } : draft.attributes
    const nextDraft = { ...draft, attributes }
    setDraft(nextDraft)
    const persistedAsset = await persistCharacterDraft(nextDraft, stage)
    await onGenerateStage(
      persistedAsset,
      stage,
      buildPromptBlueprint(nextDraft, aspectRatio, stage).finalPrompt,
      view,
    )
  }

  return {
    kind,
    kindLabel,
    draft,
    setDraft,
    characterStage,
    setCharacterStage,
    saving,
    error,
    promptBadge,
    promptBlueprint,
    generatedPrompt,
    handleSubmit,
    persistCharacterAttributes,
    generateCharacterStage,
  }
}

function promptBadgeFor(kind, characterStage, aspectRatio) {
  if (kind === 'audio') return '音频'
  if (kind !== 'character') return aspectRatio
  if (characterStage === 'face') return '1:1'
  if (characterStage === 'turnaround') return '16:9'
  return aspectRatio
}
