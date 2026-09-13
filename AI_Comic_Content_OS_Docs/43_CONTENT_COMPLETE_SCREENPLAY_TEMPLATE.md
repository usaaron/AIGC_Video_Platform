# 内容完整型剧本模板（2026-09-08）

## 结论

旧合同已经把动作与对白的交错顺序做成了结构约束，但没有定义一集真正交付时必须出现的内容索引。因此模型容易生成“像剧本的正文”，却漏掉本集出场人物、实际地点和每场的任务、阻力、结果等制作信息。

本轮保留正文格式合同 `partner_screenplay.v1`，新增内容模板 `partner_screenplay.content_complete.v1`。两者分别解决版式和内容完整性，不把内部规划字段继续塞进正式正文。

## 新模板

```text
# 第 N 集《集名》
预计时长：90 秒

## 本集信息
剧情梗概：本集实际发生的完整梗概
本集目标：人物本集要完成的具体目标
本集出场人物：人物 A（身份）、人物 B（身份）
使用场地：地点 A、地点 B

场景清单：
1. INT./EXT. 具体地点 - 日/夜
   出场人物：...
   场景任务：...
   主要阻力：...
   场景结果：...
   必要道具：...

## 正式正文
FADE IN（只有确有必要时）

INT./EXT. 具体地点 - 日/夜
△ 可拍的动作或声音
人物名
（表演提示）
台词
...

结尾直接落在最后一个动作或对白上；只有确有叙事作用时使用转场或 FADE OUT。
```

## 结构化字段

- 集级：`episode_cast`、`locations`、`synopsis`、`episode_goal`。
- 场级：`scene_heading`、`character_refs`、`content_manifest`。
- `content_manifest`：`location`、`time_of_day`、`character_refs`、`objective`、`conflict`、`turning_point`、`outcome`、`props`、`entry_state`、`exit_state`。
- 正文执行：`character_actions`、`dialogues`、`body_order`。`body_order` 只用于系统恢复真实表演顺序，不在用户稿中显示。

旧稿缺字段时，系统从对白和旧场景标题本地回填；新生成提示要求模型显式填写并沿用已批准人物。正式正文不渲染 `purpose`、`beat_summary`、`emotional_shift`、`emotional_objective`、`turning_point`、`scene_causality`、`qa_notes`、`lineage` 或其他规划、审计和账本字段。

## 代码入口

- 后端模型和兼容回填：`backend/app/modules/master_script/models.py`
- 生成映射：`backend/app/modules/script_engine/generation_service.py`、`backend/app/modules/master_script/service.py`
- 提示合同：`backend/app/modules/script_engine/prompt_builder.py`
- Markdown、纯文本和 Word 信息页：`frontend/lib/episode-export.ts`、`frontend/lib/episode-docx.ts`
- 探针样稿导出：`scripts/run_real_generation_probe.py`

## 验证

`tests/test_master_script_models.py` 覆盖旧稿回填、场级人物和集级索引；`tests/test_prompt_builder.py` 覆盖新模板提示；`frontend/tests/episode-export.test.mjs` 覆盖信息页、场景清单和原有正文交错顺序。
