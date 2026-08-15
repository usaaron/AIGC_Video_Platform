const DIALOGUE_MARKER_PATTERN = /[（(]\s*(O\.S\.|V\.O\.|CONTINUED|PRE[-‑ ]?LAP)\s*[）)]/i;
const TIME_PATTERN = /(夜晚|白天|日间|黄昏|傍晚|黎明|清晨|早晨|上午|中午|下午|深夜|瞬间|日|夜)/;
const TRANSITION_PATTERN = /(MOMENTS LATER|CONTINUOUS|LATER|SAME TIME|连续|稍后|片刻后|同时)/i;
const EXTERIOR_LOCATION_PATTERN = /(街|路|公路|停车场|公园|广场|庭院|屋顶|荒漠|沙漠|森林|树林|山|码头|海滩|河岸|车站|机场|货场|田野|门外|入口外)/;

export function clientEpisodeTitle(value: string): string {
  return value
    .replace(/^\s*(?:EPISODE|第)\s*\d+\s*(?:集)?\s*[:：—-]?\s*/i, "")
    .replace(/^[《“\"]|[》”\"]$/g, "")
    .trim();
}

export function clientDialogueSpeaker(
  displayName: string,
  sourceName: string,
): { speaker: string; marker: string } {
  const sourceMarker = sourceName.match(DIALOGUE_MARKER_PATTERN)?.[1];
  const displayMarker = displayName.match(DIALOGUE_MARKER_PATTERN)?.[1];
  const marker = (displayMarker ?? sourceMarker ?? "")
    .replace(/PRE[-‑ ]?LAP/i, "PRE-LAP")
    .toUpperCase();
  return {
    speaker: displayName.replace(DIALOGUE_MARKER_PATTERN, "").trim(),
    marker,
  };
}

export function clientSceneHeading(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (/^(?:INT|EXT)\./i.test(normalized)) {
    return normalized.replace(/^(int|ext)\./i, (match) => match.toUpperCase());
  }
  const rawTime = normalized.match(TIME_PATTERN)?.[1] ?? "日";
  const time = rawTime === "夜晚" ? "夜" : ["白天", "日间"].includes(rawTime) ? "日" : rawTime;
  const transitionValue = normalized.match(TRANSITION_PATTERN)?.[1] ?? "";
  const transition = /MOMENTS LATER|片刻后/i.test(transitionValue)
    ? "MOMENTS LATER"
    : /CONTINUOUS|连续/i.test(transitionValue)
      ? "CONTINUOUS"
      : /SAME TIME|同时/i.test(transitionValue)
        ? "SAME TIME"
        : /LATER|稍后/i.test(transitionValue)
          ? "LATER"
          : "";
  const explicitExterior = /(?:^|[，, /-])(?:室外|外景|外)(?:$|[，, /-])/.test(normalized);
  const explicitInterior = /(?:^|[，, /-])(?:室内|内景|内)(?:$|[，, /-])/.test(normalized);
  const prefix = explicitExterior || (!explicitInterior && EXTERIOR_LOCATION_PATTERN.test(normalized))
    ? "EXT."
    : "INT.";
  const location = normalized
    .replace(/[（(](?:FLASHBACK|闪回)[）)]/gi, "")
    .replace(TRANSITION_PATTERN, " ")
    .replace(/(?:^|[，, /-])(?:室内|室外|内景|外景|内|外)(?=$|[，, /-])/g, " ")
    .replace(TIME_PATTERN, " ")
    .replace(/[，, /]+/g, " ")
    .replace(/^[-–—\s]+|[-–—\s]+$/g, "")
    .trim() || "未指定地点";
  const flashback = /FLASHBACK|闪回/i.test(normalized) ? "（FLASHBACK）" : "";
  return `${prefix} ${location} ${time}${flashback}${transition ? ` - ${transition}` : ""}`;
}
