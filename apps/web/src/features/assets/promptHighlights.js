// Highlight offsets use the textarea's UTF-16 positions; the stored prompt stays plain text.
export function adjustPromptHighlights(previous, next, ranges, edit) {
  if (previous === next) return ranges
  let start = edit?.start ?? 0
  let end = edit?.end ?? previous.length
  if (!edit) {
    while (start < previous.length && start < next.length && previous[start] === next[start]) start++
    let nextEnd = next.length
    while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) {
      end--
      nextEnd--
    }
  }
  const delta = next.length - previous.length
  const insertedEnd = end + delta
  const updated = ranges.flatMap((range) => {
    if (range.end <= start) return [range]
    if (range.start >= end) return [{ start: range.start + delta, end: range.end + delta }]
    return [
      { start: range.start, end: start },
      { start: insertedEnd, end: range.end + delta },
    ].filter((part) => part.start < part.end)
  })
  // Typing within a highlighted passage inherits its color; asset/script insertions do not.
  if (!edit && ranges.some((range) => range.start <= start && range.end > start && range.end >= end))
    updated.push({ start, end: insertedEnd })
  return mergePromptHighlights(updated)
}

export function mergePromptHighlights(ranges) {
  const merged = []
  for (const range of [...ranges]
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}
