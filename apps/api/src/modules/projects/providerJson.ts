import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'
import { AppError } from '../../core/errors.js'

export function parseProviderJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  errorMessage: string,
  normalize: (value: unknown) => unknown = (value) => value,
): T {
  for (const candidate of providerJsonCandidates(raw)) {
    try {
      const result = schema.safeParse(normalize(parseJsonCandidate(candidate)))
      if (result.success) return result.data
    } catch {
      // Continue through the remaining fenced, balanced, and repaired candidates.
    }
  }
  throw new AppError(502, 'PROVIDER_RESPONSE_INVALID', errorMessage)
}

function providerJsonCandidates(raw: string): string[] {
  const text = raw
    .trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
  const candidates: string[] = [text]
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]) candidates.push(match[1].trim())
  }

  const initialCandidates = candidates.slice()
  for (const source of initialCandidates) {
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== '{' && source[index] !== '[') continue
      const balanced = balancedJsonSlice(source, index)
      if (balanced) candidates.push(balanced)
      candidates.push(source.slice(index).trim())
      if (candidates.length >= 24) break
    }
    if (candidates.length >= 24) break
  }

  return [...new Set(candidates.filter(Boolean))]
}

function balancedJsonSlice(text: string, start: number): string | null {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{' || character === '[') stack.push(character)
    if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '['
      if (stack.pop() !== expected) return null
      if (!stack.length) return text.slice(start, index + 1)
    }
  }
  return null
}

function parseJsonCandidate(candidate: string): unknown {
  let value: unknown = JSON.parse(jsonrepair(candidate))
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
    const nested = value.trim()
    if (!nested.startsWith('{') && !nested.startsWith('[')) break
    value = JSON.parse(jsonrepair(nested))
  }
  return value
}
