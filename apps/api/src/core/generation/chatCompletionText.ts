export type CompletionParts = {
  content: string
  reasoning: string
}

export type CompletionTextOptions = {
  /** OpenAI-compatible responses may contain more than one choice. */
  choiceMode?: 'all' | 'first'
  includeReasoning?: boolean
}

const nestedCompletionKeys = ['data', 'result', 'output', 'response', 'payload'] as const

export function completionParts(
  value: unknown,
  options: CompletionTextOptions = {},
): CompletionParts {
  const choiceMode = options.choiceMode ?? 'all'
  const includeReasoning = options.includeReasoning ?? true
  if (!isRecord(value)) return { content: textFromValue(value), reasoning: '' }

  let content = textFromValue(value.output_text ?? value.text ?? value.content)
  let reasoning = includeReasoning
    ? textFromValue(value.reasoning_content ?? value.reasoning)
    : ''
  if (choiceMode === 'first' && content) return { content, reasoning }
  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      if (!isRecord(choice)) continue
      const delta = isRecord(choice.delta) ? choice.delta : undefined
      const message = isRecord(choice.message) ? choice.message : undefined
      const choiceContent = textFromValue(
        delta?.content ?? delta?.text ?? message?.content ?? message?.text ?? choice.text ?? choice.content,
      )
      content += choiceContent
      if (includeReasoning) {
        reasoning += textFromValue(
          delta?.reasoning_content ??
            delta?.reasoning ??
            message?.reasoning_content ??
            message?.reasoning ??
            choice.reasoning_content,
        )
      }
      if (choiceMode === 'first' && choiceContent) break
    }
  }

  if (!content && !reasoning) {
    for (const key of nestedCompletionKeys) {
      if (!(key in value)) continue
      const nested = completionParts(value[key], options)
      content += nested.content
      reasoning += nested.reasoning
      if (content || reasoning) break
    }
  }
  return { content, reasoning }
}

export function completionText(value: unknown, options: CompletionTextOptions = {}): string {
  return completionParts(value, options).content
}

export function trimCompletionText(value: unknown, options: CompletionTextOptions = {}): string {
  return completionText(value, options).trim()
}

export function streamChunkFinished(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.done === true || value.finished === true || value.status === 'completed') return true
  if (!Array.isArray(value.choices)) return false
  return value.choices.some(
    (choice) =>
      isRecord(choice) && typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0,
  )
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function readProviderErrorMessage(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  let message = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    message = parsed.error?.message || parsed.message || message
  } catch {
    // Keep the bounded text response when the provider does not return JSON.
  }
  return message
}

function textFromValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''
      return textFromValue(part.text ?? part.content ?? part.value)
    })
    .filter(Boolean)
    .join('')
}
