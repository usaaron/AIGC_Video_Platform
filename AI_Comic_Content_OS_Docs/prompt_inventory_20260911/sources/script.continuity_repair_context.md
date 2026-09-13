# 连续性修复的受影响证据包

编号：`script.continuity_repair_context`。状态：`连续性重试引用的上下文`。

来源：[backend/app/modules/script_engine/generation_service.py:8502](/Users/simonriley/Downloads/docs/backend/app/modules/script_engine/generation_service.py:8502)。符号：`ScriptGenerationService._build_continuity_repair_context`。

不是独立模型调用，仅受影响场景与账本。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````python
    @staticmethod
    def _build_continuity_repair_context(
        *,
        output: dict[str, object],
        report: ContinuityQCReport,
    ) -> str:
        """Keep follow-up continuity repair focused on the failing evidence."""
        scene_numbers = {
            number
            for issue in report.issues
            if issue.severity.value == "blocking"
            for number in issue.scene_numbers
        }
        raw_scenes = output.get("scenes")
        scenes = [
            scene
            for scene in raw_scenes
            if isinstance(scene, dict)
            and scene.get("scene_number") in scene_numbers
        ] if isinstance(raw_scenes, list) else []
        context: dict[str, object] = {
            "affected_scenes": scenes,
            "character_state_updates": output.get("character_state_updates", []),
            "continuity_state_updates": output.get("continuity_state_updates", []),
            "story_line_updates": output.get("story_line_updates", []),
            "setup_payoff_updates": output.get("setup_payoff_updates", []),
        }
        return json.dumps(context, ensure_ascii=False, separators=(",", ":"))
````

片段 SHA-256：`d825d33f48a99ccc15e7cd05744620dbfbf04dbda34a169da050ca600d7c8a0c`
