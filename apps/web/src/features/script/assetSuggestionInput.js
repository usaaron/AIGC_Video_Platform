import { createDefaultAttributes } from '../assets/assetOptions'

export function suggestionToAssetInput(suggestion) {
  const kind = suggestion.kind
  const attributes = {
    ...createDefaultAttributes(kind),
    ...suggestion.attributes,
    type: kind,
  }
  const prompt = String(suggestion.prompt || '').trim()
  const sourceFacts = Object.entries(suggestion.sourceFacts || {})
    .filter(([, value]) => String(value || '').trim())
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
