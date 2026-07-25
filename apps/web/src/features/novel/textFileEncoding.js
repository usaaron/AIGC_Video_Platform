const DECODER_CANDIDATES = ['gb18030', 'gbk', 'gb2312', 'big5']
const MOJIBAKE_PATTERN = /锟斤拷|銆|鐨|涓|锛|鈥|妗|绔|浠|珨|腔|衄|饒|欴|[ÃÂâ]/gu
const COMMON_SIMPLIFIED_PATTERN =
  /[的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经]/gu
const CJK_PATTERN = /\p{Script=Han}/gu
const CJK_PUNCTUATION_PATTERN = /[，。！？；：“”‘’（）《》、]/gu
const REPLACEMENT_PATTERN = /\uFFFD/gu

export function decodeNovelFileText(buffer) {
  const bytes = new Uint8Array(buffer)
  const utf8 = decodeWith('utf-8', bytes, true)
  if (utf8 && !looksLikeMojibake(utf8.text)) return utf8

  const candidates = DECODER_CANDIDATES.map((encoding) => decodeWith(encoding, bytes, false)).filter(Boolean)
  const fallbackUtf8 = decodeWith('utf-8', bytes, false)
  if (fallbackUtf8) candidates.push(fallbackUtf8)
  if (!candidates.length) throw new Error('无法识别小说文件编码，请转成 UTF-8 后再导入')

  return candidates.sort((left, right) => scoreDecodedText(right.text) - scoreDecodedText(left.text))[0]
}

export function looksLikeMojibake(text) {
  const sample = text.slice(0, 20_000)
  const replacementCount = countMatches(sample, REPLACEMENT_PATTERN)
  const suspiciousCount = countMatches(sample, MOJIBAKE_PATTERN)
  return (
    replacementCount > Math.max(8, sample.length * 0.004) ||
    suspiciousCount > Math.max(12, sample.length * 0.006)
  )
}

function decodeWith(encoding, bytes, fatal) {
  try {
    const decoder = new TextDecoder(encoding, { fatal })
    return { text: decoder.decode(bytes), encoding }
  } catch {
    return null
  }
}

function scoreDecodedText(text) {
  const sample = text.slice(0, 20_000)
  return (
    countMatches(sample, CJK_PATTERN) * 2 +
    countMatches(sample, COMMON_SIMPLIFIED_PATTERN) * 6 +
    countMatches(sample, CJK_PUNCTUATION_PATTERN) * 4 -
    countMatches(sample, REPLACEMENT_PATTERN) * 200 -
    countControlCharacters(sample) * 80 -
    countMatches(sample, MOJIBAKE_PATTERN) * 30
  )
}

function countMatches(value, pattern) {
  return value.match(pattern)?.length ?? 0
}

function countControlCharacters(value) {
  let count = 0
  for (const character of value) {
    const code = character.charCodeAt(0)
    if ((code >= 0x00 && code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) {
      count += 1
    }
  }
  return count
}
