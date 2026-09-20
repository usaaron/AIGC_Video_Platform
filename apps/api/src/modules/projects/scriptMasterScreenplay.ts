const sceneHeading = /^(INT\.(?:\s*\/\s*EXT\.)?|EXT\.(?:\s*\/\s*INT\.)?)\s+([^\n]+)$/iu
const parenthetical = /^[（(][\s\S]*[）)]$/u

/** Read only the formal export body; prefatory scene indexes are not production scenes. */
export function scriptMasterSceneHeadings(script: string): string[] | undefined {
  const text = script.replace(/\r/gu, '')
  const marker = /^正式正文\s*\n\s*FADE IN \/ 淡入[：:]\s*\n/gmu.exec(text)
  if (
    !/^\s*第\s*\d+\s*集(?:《[^\n]*》)?\s*\n/u.test(text) ||
    !marker ||
    !/^预计时长[：:]/mu.test(text.slice(0, marker.index)) ||
    !/\n\s*FADE OUT \/ 淡出[。.]*\s*$/u.test(text)
  )
    return undefined
  const headings = text
    .slice(marker.index + marker[0].length)
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => sceneHeading.test(block))
  return headings.length ? headings : undefined
}

/** Adapt explicit Script Master exports for downstream scene and asset parsing. */
export function normalizeScriptMasterScreenplay(script: string): string {
  const text = script.replace(/\r/gu, '')
  const episode = text.match(/^\s*第\s*(\d+)\s*集(?:《[^\n]*》)?\s*\n/u)
  const bodyMarker = /^正式正文\s*\n\s*FADE IN \/ 淡入[：:]\s*\n/gmu.exec(text)
  if (!episode || !bodyMarker || !/\n\s*FADE OUT \/ 淡出[。.]*\s*$/u.test(text)) return script
  const preface = text.slice(0, bodyMarker.index)
  // Edited quick drafts omit their obsolete information index. The complete
  // export wrapper still identifies the body without requiring that index.
  if (!/^预计时长[：:]/mu.test(preface)) return script
  const body = text
    .slice(bodyMarker.index + bodyMarker[0].length)
    .replace(/\n\s*FADE OUT \/ 淡出[。.]*\s*$/u, '')
  const blocks = body
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter(Boolean)
  if (!blocks.some((block) => sceneHeading.test(block))) return script

  const lines = [`第${episode[1]}集`]
  let sceneNumber = 0
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!
    const heading = block.match(sceneHeading)
    if (heading) {
      sceneNumber += 1
      const spatial = heading[1]!.includes('/') ? '内外景' : /^EXT/iu.test(heading[1]!) ? '外景' : '内景'
      lines.push(`场次：S${String(sceneNumber).padStart(2, '0')}｜${heading[2]}｜${spatial}`)
      continue
    }
    if (block.startsWith('△') || block.startsWith('【强制') || !sceneNumber) {
      lines.push(block)
      continue
    }
    // The export places a speaker, optional intent, then dialogue in separate blocks.
    // Keep the original action and dialogue text, including voice and performance cues.
    const intent = blocks[index + 1] && parenthetical.test(blocks[index + 1]!) ? blocks[index + 1]! : ''
    const dialogueIndex = index + (intent ? 2 : 1)
    const dialogue = blocks[dialogueIndex]
    const speaker = block.match(/^([^\n：:。！？!?]{1,120}?)(?:\s+\((O\.S\.|V\.O\.|CONTINUED|PRE-LAP)\))?$/iu)
    if (speaker && dialogue && !sceneHeading.test(dialogue) && !/^(?:△|【强制)/u.test(dialogue)) {
      const marker = speaker[2] ? `（${speaker[2]}）` : ''
      const spokenText = `${marker}${intent}${dialogue}`.replace(/\n+/gu, ' ')
      lines.push(`[对白]${speaker[1]!.trim()}：${spokenText}`)
      index = dialogueIndex
      if (/^中文[：:]/u.test(blocks[index + 1] ?? '')) {
        lines[lines.length - 1] += ` ${blocks[++index]!.replace(/\n+/gu, ' ')}`
      }
    } else {
      lines.push(block)
    }
  }
  return lines.join('\n')
}
