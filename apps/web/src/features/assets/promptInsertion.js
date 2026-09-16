import { flushSync } from 'react-dom'

export function insertPromptAtCursor(target, value, text, onChange, separator = '；') {
  const source = String(value || '')
  const start = typeof target?.selectionStart === 'number' ? target.selectionStart : source.length
  const end = typeof target?.selectionEnd === 'number' ? target.selectionEnd : start
  const before = source.slice(0, start)
  const after = source.slice(end)
  const prefix = before && !/[\s，。；：:|]/u.test(before.slice(-1)) ? separator : ''
  const scroll = target ? { left: target.scrollLeft, top: target.scrollTop } : null
  const pageScroll = { left: window.scrollX, top: window.scrollY }
  // Commit the controlled value before moving the caret, without a delayed move
  // that could override the user's next click or keystroke.
  flushSync(() => onChange?.(`${before}${prefix}${text}${after}`))
  if (!target?.isConnected) return
  const cursor = start + prefix.length + text.length
  target.focus({ preventScroll: true })
  target.setSelectionRange(cursor, cursor)
  target.scrollLeft = scroll.left
  target.scrollTop = scroll.top
  window.scrollTo(pageScroll.left, pageScroll.top)
}
