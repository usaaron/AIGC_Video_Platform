const HONGGUO_TAG_PREFIX = "custom.hongguo.";

export function hongguoTagId(label: string): string {
  return HONGGUO_TAG_PREFIX + Array.from(label).map((character) => (
    character.codePointAt(0)!.toString(36).padStart(4, "0")
  )).join("");
}

export function hongguoTagLabel(id: string): string | undefined {
  if (!id.startsWith(HONGGUO_TAG_PREFIX)) return undefined;
  const encoded = id.slice(HONGGUO_TAG_PREFIX.length);
  if (!/^(?:[0-9a-z]{4}){1,20}$/.test(encoded)) return undefined;
  const points = encoded.match(/.{4}/g)!.map((part) => Number.parseInt(part, 36));
  if (points.some((point) => point > 0x10ffff)) return undefined;
  return String.fromCodePoint(...points);
}
