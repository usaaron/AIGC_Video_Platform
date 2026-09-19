"""Read explicit production metadata without inferring it from story prose."""
from __future__ import annotations

import re


_TIME = re.compile(
    r"(?:^|[，,。·、 /—–-])(夜间|夜晚|白天|日间|黄昏|傍晚|黎明|清晨|早晨|上午|中午|下午|深夜|日|夜)"
    r"(?=$|[，,。·、 /（(—–-])", re.IGNORECASE,
)
_ENGLISH_TIME = re.compile(r"(?:^|[ /—–-])(DAY|NIGHT)(?=$|\s*[（(]|\s*-\s*(?:LATER|CONTINUOUS|MOMENTS LATER|SAME TIME))", re.IGNORECASE)


def explicit_scene_time(value: str) -> str | None:
    match = _TIME.search(value) or _ENGLISH_TIME.search(value)
    return match.group(1) if match else None


def scene_heading_with_known_time(heading: str, time_of_day: str | None) -> str:
    """Fill an absent heading time from the manifest; never replace an explicit one."""
    if not explicit_scene_time(heading) and time_of_day and explicit_scene_time(time_of_day):
        return f"{heading} {time_of_day}"
    return heading


def explicit_scene_environment(value: str) -> str | None:
    match = re.match(r"^\s*(INT|EXT)\.", value, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    match = re.search(r"(?:^|[，,·、 /-])(室内|室外|内景|外景|内|外)(?=$|[，,·、 /-])", value)
    if match:
        return "INT" if match.group(1) in {"室内", "内景", "内"} else "EXT"
    return None


def scene_metadata_conflicts(heading: str, setting: str, time_of_day: str) -> list[str]:
    findings = []
    heading_environment, setting_environment = map(explicit_scene_environment, (heading, setting))
    if heading_environment and setting_environment and heading_environment != setting_environment:
        findings.append(f"正式场标为{heading_environment}，环境描述为{setting_environment}；请统一内外景。")
    night = {"夜", "夜晚", "夜间", "深夜", "night"}
    day = {"日", "白天", "日间", "清晨", "早晨", "上午", "中午", "下午", "day"}
    labels = []
    periods = set()
    for label, value in (("正式场标", heading), ("环境描述", setting), ("制作清单", time_of_day)):
        time = explicit_scene_time(value)
        if not time:
            continue
        period = "night" if time.casefold() in night else "day" if time.casefold() in day else None
        if period:
            periods.add(period)
            labels.append(f"{label}为{time}")
    if len(periods) > 1:
        findings.append("、".join(labels) + "；请统一昼夜，不能据此确定拍摄光线。")
    return findings
