"""Keep a future rebuild inside its server-owned production allocation."""
from copy import deepcopy
import json
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError

EPISODE_BUDGET_FIELDS = ("target_duration_seconds", "planned_shot_count", "planned_dialogue_line_count")
SCENE_BUDGET_FIELDS = ("dialogue_line_target", "shot_target")


def future_rebuild_schema(schema: dict, context: dict | None) -> dict:
    if context is None:
        return schema
    result = deepcopy(schema)
    budget = context["budget"]
    for shape in [result, *result.get("$defs", {}).values()]:
        properties = shape.get("properties", {})
        if not {"episode_number", "scene_execution_plan"} <= properties.keys():
            continue
        fixed = {"episode_number": context["episode_number"]}
        if "ending_mode" in context:
            fixed["ending_mode"] = context["ending_mode"]
        for field, value in fixed.items():
            properties[field] = {"const": value}
            if field not in shape["required"]:
                shape["required"].append(field)
        for field in (*EPISODE_BUDGET_FIELDS, "planned_scene_count"):
            properties.pop(field, None)
        shape["required"] = [field for field in shape["required"] if field not in (*EPISODE_BUDGET_FIELDS, "planned_scene_count")]
        scenes = properties["scene_execution_plan"]
        # The shared wire format derives scene_count and sets minItems=1; keep
        # this existing allocation in a separate constraint that it preserves.
        scenes["allOf"] = [{"minItems": budget["planned_scene_count"], "maxItems": budget["planned_scene_count"]}]
        scenes["prefixItems"] = [{"properties": {"scene_number": {"const": scene["scene_number"]}},
                                 "required": ["scene_number"]} for scene in budget["scenes"]]
    for shape in [result, *result.get("$defs", {}).values()]:
        properties = shape.get("properties", {})
        if {"scene_number", "scene_heading", "scene_objective"} <= properties.keys():
            for field in SCENE_BUDGET_FIELDS:
                properties.pop(field, None)
            shape["required"] = [field for field in shape.get("required", []) if field not in SCENE_BUDGET_FIELDS]
    return result


def bind_future_rebuild_budget(payload: dict, context: dict) -> dict:
    """Bind only saved production numbers to explicit episode/scene identities."""
    def fail(message):
        raise LongStoryPersistenceConflictError("Future roadmap rebuild: " + message)

    items = payload.get("episode_plans")
    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
        fail("fixed budget binding requires exactly one complete episode object.")
    item = items[0]
    if type(item.get("episode_number")) is not int or item["episode_number"] != context["episode_number"]:
        fail("fixed budget binding requires the explicitly requested episode_number.")
    budget = context["budget"]
    scenes = item.get("scene_execution_plan")
    if (not isinstance(scenes, list) or len(scenes) != budget["planned_scene_count"]
            or any(not isinstance(scene, dict) or type(scene.get("scene_number")) is not int
                   or scene["scene_number"] != saved["scene_number"]
                   for scene, saved in zip(scenes, budget["scenes"]))):
        fail("fixed budget binding requires every saved scene_number exactly once and in order.")

    def fixed_fields(authored, fields):
        result = deepcopy(authored)
        for field, value in fields.items():
            if field in authored and (type(authored[field]) is not int or authored[field] != value):
                fail(f"rebuild changed the saved {field}.")
            result[field] = value
        return result

    bound = fixed_fields(item, {field: budget[field] for field in (*EPISODE_BUDGET_FIELDS, "planned_scene_count")})
    bound["scene_execution_plan"] = [fixed_fields(scene, {field: saved[field] for field in SCENE_BUDGET_FIELDS})
                                     for scene, saved in zip(scenes, budget["scenes"])]
    return {**payload, "episode_plans": [bound]}


def future_rebuild_prompt(context: dict | None) -> str:
    if context is None:
        return ""
    return (
        "\n\n【已批准事件的后续详细规划重建】本次是按最新批准逐集事件重新编排本集完整行动、"
        "交锋和后果，不是润色旧梗概。旧详细规划的录音、等待、取件、知情和禁止变化等叙事"
        "不能覆盖最新批准事件；旧文仅提供下列已确定的制作预算。此前已完成结果不重演，"
        "当集承诺、证人保护、交付和结果须由本集真实行动兑现，不能只登记或宣布。"
        "输出前逐项核对批准事件与分场：每项本集必须发生的结果，都须在至少一场visible_action中"
        "有现场人物完成的动作和后果；只出现在synopsis、dramatic_units或episode_payoff不算落实。"
        "按场次顺序承接状态：上一场已完成的签收、建项、核对不能在下一场重新首次完成；"
        "若继续争辩同一结果，须写清新的质疑、回应和后果，而非复制上一场的行动。"
        "逐场同步检查目标、行动、依据、对白目的与离场状态，不能一处写待确认、另一处已完成。"
        "forbidden_changes只限制越界事实，不能禁止本集批准事件要求的回应、选择或执行；"
        "批准事件已使任务可执行时，不得新增必须先取得原件等阻断条件，副本查看与原件持有须分清。"
        "正数对白预算须有足够的真实交流目的，不能同时规定全场只说一句或仅沉默离开；"
        "保留强情绪、直接表达和有目的的持续攻防，不要求每句都提供新线索。"
        "指控、当事人声称、核查结果须区分；某人未持有原件不能反推其曾持有或负有移交义务。"
        "本次保留已确定场数及逐场镜头、对白分配，在这些场中承载新批准事件；不得重新选择数值，"
        "对白为0的场必须保持静默，不得机械摊句。制作预算由服务器按明确集号与场号绑定，"
        "本次JSON不输出target_duration_seconds、planned_scene_count、planned_shot_count、"
        "planned_dialogue_line_count，以及场内dialogue_line_target和shot_target；不得自行重算或照抄。"
        "实际场景数组必须恰好对应全部既定场号。其他泛化场数统计建议不得覆盖本次明确预算。"
        "剧集结尾模式保持既定值，最终集要实际兑现批准结局。\n"
        + json.dumps({key: context[key] for key in ("episode_number", "source_evidence", "budget", "ending_mode") if key in context},
                     ensure_ascii=False, separators=(",", ":"))
    )
