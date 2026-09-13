from __future__ import annotations

import re
import unicodedata


TAXONOMY_REVISION = 2

# Exact source labels and known synonyms only. Unknown labels remain project keywords.
TAG_IDS = {
    "恋爱": "genre.romance", "古风爱情": "genre.costume_romance",
    "现代都市": "genre.urban", "江湖武侠": "genre.wuxia", "动作打斗": "genre.action",
    "逆袭翻身": "theme.power_growth", "逆风翻盘": "theme.power_growth",
    "马甲文": "theme.hidden_identity",
    "古代": "world.ancient", "古装": "world.ancient",
    "爱情": "genre.romance", "现代言情": "genre.modern_romance",
    "都市爱情": "genre.modern_romance", "古代言情": "genre.costume_romance",
    "都市": "genre.urban", "玄幻": "genre.fantasy", "仙侠": "genre.xianxia",
    "武侠": "genre.wuxia", "科幻": "genre.scifi", "悬疑": "genre.mystery",
    "惊悚": "genre.horror", "喜剧": "genre.comedy", "动作": "genre.action",
    "历史": "genre.historical", "校园": "genre.school", "末日": "genre.apocalypse",
    "末世": "genre.apocalypse", "家庭": "genre.family", "家庭伦理": "genre.family",
    "复仇": "theme.revenge", "重生": "theme.rebirth", "穿越": "theme.transmigration",
    "系统": "theme.system", "逆袭": "theme.power_growth", "逆袭成长": "theme.power_growth",
    "隐藏身份": "theme.hidden_identity", "真假千金": "theme.true_fake_heir",
    "豪门": "theme.wealthy_family", "商战": "theme.business_war", "权谋": "theme.palace_intrigue",
    "探案": "theme.investigation", "修真": "theme.cultivation", "修仙": "theme.cultivation",
    "异能": "theme.supernatural_power", "无限流": "theme.infinite_flow",
    "末日求生": "theme.apocalypse_survival", "时间循环": "theme.time_loop",
    "契约关系": "relationship.contract", "先婚后爱": "relationship.marriage_first_love_later",
    "破镜重圆": "relationship.reconciliation", "追妻火葬场": "relationship.chasing_spouse",
    "禁忌关系": "relationship.forbidden_love", "家族冲突": "relationship.family_conflict",
    "爽感": "emotion.satisfying", "悬念": "emotion.suspense", "甜宠": "emotion.sweet",
    "虐心": "emotion.tragic", "治愈": "emotion.healing", "热血": "emotion.hot_blooded",
}
NOISE_LABELS = {"全部", "新剧", "完结", "已完结", "连载", "连载中", "更新中"}


def source_label(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    label = " ".join(value.replace("\x00", "").split())
    numeric = unicodedata.normalize("NFKC", label)
    if (not label or label in NOISE_LABELS or len(label) > 20
            or re.fullmatch(r"[\d\s.+%-]+", numeric)
            or re.fullmatch(r"(?:全|共|更新至)?\d+集", numeric)):
        return None
    return label
