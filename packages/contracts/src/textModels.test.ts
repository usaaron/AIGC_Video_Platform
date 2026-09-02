import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCRIPT_MODEL,
  SCRIPT_MODEL_CATALOG,
  resolveDeepSeekV4TextModel,
  resolveGptTextModel,
  scriptModelSchema,
  textModelFamily,
} from './textModels.js'

describe('text model catalog', () => {
  it('keeps the default model selectable and every public id contract-valid', () => {
    expect(SCRIPT_MODEL_CATALOG.some((model) => model.id === DEFAULT_SCRIPT_MODEL)).toBe(true)
    for (const model of SCRIPT_MODEL_CATALOG) {
      expect(scriptModelSchema.parse(model.id)).toBe(model.id)
    }
  })

  it.each([
    ['deepseek-v3', 'deepseek-v3'],
    ['deepseek-v4-flash', 'deepseek-v4'],
    ['seqora-5.6', 'gpt'],
    ['gpt-5.6-sol', 'gpt'],
    ['glm-5.2', 'rehdasu'],
    ['unknown-model', 'unsupported'],
  ] as const)('classifies %s as %s', (model, family) => {
    expect(textModelFamily(model)).toBe(family)
  })

  it('resolves provider-facing aliases without changing stored public ids', () => {
    expect(resolveGptTextModel('seqora-5.6')).toBe('gpt-5.6-sol')
    expect(resolveGptTextModel('gpt-5.6-terra')).toBe('gpt-5.6-terra')
    expect(resolveDeepSeekV4TextModel('deepseek-v4-flash', 'deepseek-v4-flash-0731')).toBe(
      'deepseek-v4-flash-0731',
    )
    expect(resolveDeepSeekV4TextModel('deepseek-v4-pro', 'deepseek-v4-flash-0731')).toBe('deepseek-v4-pro')
  })
})
