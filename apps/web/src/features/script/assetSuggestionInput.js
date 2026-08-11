import { createDefaultAttributes } from '../assets/assetOptions'

export function suggestionToAssetInput(suggestion) {
  const kind = suggestion.kind
  const attributes = {
    ...createDefaultAttributes(kind),
    ...suggestion.attributes,
    type: kind,
  }
  const prompt = String(suggestion.prompt || '').trim()
  return {
    kind,
    sourceMode: 'generate',
    name: String(suggestion.name || '').trim(),
    description: String(suggestion.description || '').trim(),
    prompt,
    promptMode: 'advanced',
    customPromptMode: 'replace',
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
