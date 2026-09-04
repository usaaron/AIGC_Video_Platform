import { createDefaultAttributes } from '../assets/assetOptions'

const NON_VISUAL_FACT_LABELS = new Set(['故事作用', '剧情作用', '作用', '故事', '剧情', '目的', '目标'])

export function suggestionToAssetInput(suggestion) {
  const kind = suggestion.kind
  const attributes = {
    ...createDefaultAttributes(kind),
    ...suggestion.attributes,
    type: kind,
  }
  const prompt = String(suggestion.prompt || '').trim()
  const sourceFacts = Object.entries(suggestion.sourceFacts || {})
    .filter(([label, value]) => !NON_VISUAL_FACT_LABELS.has(label.trim()) && String(value || '').trim())
    .map(([label, value]) => `${label}：${String(value).trim()}`)
    .join('；')
  const description = [String(suggestion.description || '').trim(), sourceFacts]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join('；')
    .slice(0, 500)
  return {
    kind,
    sourceMode: 'generate',
    name: String(suggestion.name || '').trim(),
    description,
    prompt,
    promptMode: 'advanced',
    customPromptMode: 'append',
    customPrompt: prompt,
    negativePrompt: String(suggestion.negativePrompt || '').trim(),
    references: [],
    attributes,
    imageUrl: null,
  }
}

export function suggestionWithPrompt(suggestion, prompt) {
  return {
    ...suggestion,
    prompt: String(prompt ?? suggestion.prompt ?? '').trim(),
  }
}
