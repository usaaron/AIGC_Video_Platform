import { z } from 'zod'

export const SCRIPT_MODEL_IDS = [
  'seqora-5.6',
  'seqora-op-5',
  'kimi-3',
  'deepseek-v3',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'qwen3.8',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'kimi-k3',
  'glm-5.2',
  'glm-5.2-fast',
  'kimi-k2.5',
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6',
] as const

export const scriptModelSchema = z.enum(SCRIPT_MODEL_IDS)
export const textModelSchema = scriptModelSchema
export const DEFAULT_SCRIPT_MODEL = 'deepseek-v4-flash' as const
export const ASSET_SUGGESTION_MODEL = 'deepseek-v4-flash' as const

export type ScriptModel = z.infer<typeof scriptModelSchema>
export type TextModel = ScriptModel
export type TextModelFamily = 'deepseek-v3' | 'deepseek-v4' | 'gpt' | 'rehdasu' | 'unsupported'

export type ScriptModelDefinition = {
  id: ScriptModel
  label: string
  family: Exclude<TextModelFamily, 'unsupported'>
}

// Only models intentionally exposed in the short-script UI belong here. SCRIPT_MODEL_IDS also
// contains stored legacy values so old projects and tasks remain readable during migration.
export const SCRIPT_MODEL_CATALOG: readonly ScriptModelDefinition[] = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', family: 'deepseek-v4' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', family: 'deepseek-v4' },
  { id: 'glm-5.2', label: 'GLM 5.2', family: 'rehdasu' },
  { id: 'gpt-5.6-sol', label: '序幕-5.6', family: 'gpt' },
] as const

export function textModelFamily(model: string): TextModelFamily {
  const normalized = normalizeTextModel(model)
  if (normalized === 'deepseekv3' || normalized === 'deepseek-v3') return 'deepseek-v3'
  if (normalized === 'deepseek-v4-flash' || normalized === 'deepseek-v4-pro') return 'deepseek-v4'
  if (normalized === 'seqora-5.6' || normalized.startsWith('gpt-')) return 'gpt'
  if (/^(glm-5\.2|glm-5\.2-fast|kimi-k3|kimi-k3-thinking)$/.test(normalized)) return 'rehdasu'
  return 'unsupported'
}

export function resolveGptTextModel(model: string): string {
  return normalizeTextModel(model) === 'seqora-5.6' ? 'gpt-5.6-sol' : model.trim()
}

export function resolveDeepSeekV4TextModel(model: string, configuredFlashModel: string): string {
  return normalizeTextModel(model) === 'deepseek-v4-flash' ? configuredFlashModel : model.trim()
}

export function isDeepSeekPublicAlias(model: string): boolean {
  const normalized = normalizeTextModel(model)
  return normalized === 'deepseekv3' || normalized === 'deepseek-v3'
}

export function isRehdasuPublicAlias(model: string): boolean {
  const normalized = normalizeTextModel(model)
  return normalized === 'rehdasu' || normalized === 'rehdasu-default'
}

function normalizeTextModel(model: string): string {
  return model.trim().toLowerCase()
}
