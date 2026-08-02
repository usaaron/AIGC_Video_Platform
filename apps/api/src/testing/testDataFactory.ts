export type TestDataFactory = ReturnType<typeof createTestDataFactory>

export function createTestDataFactory(scope = 'test') {
  let sequence = 0
  const normalizedScope = normalize(scope)
  const displayScope = title(scope)

  return {
    email(label = 'user'): string {
      return `${normalize(label)}-${normalizedScope}-${next()}@example.test`
    },
    displayName(label = 'User'): string {
      return `${title(label)} ${displayScope} ${next()}`
    },
    tenantName(label = 'Organization'): string {
      return `${title(label)} ${displayScope} ${next()}`
    },
    projectName(label = 'Project'): string {
      return `${title(label)} ${displayScope} ${next()}`
    },
    referenceId(label = 'reference'): string {
      return `${normalize(label)}-${normalizedScope}-${next()}`
    },
    sessionLabel(label = 'device'): string {
      return `${title(label)} ${displayScope} ${next()}`
    },
  }

  function next(): number {
    sequence += 1
    return sequence
  }
}

function normalize(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  )
}

function title(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
  return cleaned ? cleaned.replace(/\b\w/g, (char) => char.toUpperCase()) : 'Item'
}
