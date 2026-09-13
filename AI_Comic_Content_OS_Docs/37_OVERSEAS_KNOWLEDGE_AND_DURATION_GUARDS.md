# 海外知识状态与编辑时长修复

日期：2026-09-08（Asia/Shanghai）。范围：第 36 号真实样本的 S01–S03，以及时长编辑过冲和成功状态残留。本轮没有真实模型请求，没有新增生成费用。

## 结果

已完成产品知识状态提示和保守冲突诊断、局部编辑秒数预算、成功后的编辑状态清理。第 36 号样本在独立副本完成 6 处显式修订，保存为 revised/provisional，正确知识状态经过产品投影、持久化、记忆召回和第二集提示词验证。原稿及其失败结论不变。

后端全量 `1134 passed, 1 skipped`，30.86 秒；1 条已有 TestClient 依赖弃用警告。修订脚本、产品复检和双语转换全部零模型调用。本轮完成的是修复及离线验证，没有重新生成三集，也没有证明实际模型已降低耗时、调用次数或费用。

## 知识状态

第 36 号样本的已保存初稿、模型结果字段和最终稿都将两人物已核实的时间差标为 `disproved`。本轮验证两个机械归一化入口对五个合法知识枚举均原样保留，不改写输入，也不会因“确认”文字直接将状态改成 known。没有发现把合法 known 确定性改为 disproved 的路径；此前没有独立原始网络响应快照，因此不将应用保存的字段当成完整网络取证。

`prompt_builder.py` 增加共享 `KnowledgeStatusContract`，有/无序列化 EpisodeContext 均只注入一次。status 必须指向 statement 自身的命题和人物集末认知：驳倒其他假说不等于驳倒观察事实；知道实际事故时间尚未查明，不等于已知道实际时间；先确认后更正必须记录更正过程和最终状态。

`continuity_qc.py` 增加同集 `knowledge_conflict` warning：同一人物知识变更明确以“确认/核实/查实/证实”或有限英文同义表达确认某陈述，却把该陈述标为 disproved 时提示核对。比较完整陈述，或仅省略明确的共同时间基准限定；不任意丢弃逗号后的其他主张。保留数字标点，避免 16.5 与 165 被合并。转述、计划、条件、不同数字、后续更正等反例覆盖。

新提示不自动批准或改写事实，诊断仍是非阻断、有限文本匹配。已经存在的撤回/更正标记会保守抑制检测，复杂语义、同义改写和来源不明的知识仍可能漏检。warning 不能证明正文事实真假，也不能作为完备的语义门禁。相同知识键的两个角色分别产生问题 ID，不再互相去重覆盖；其他既有问题 ID 算法保持原行为。

原样本在新检查器下为 2 条知识 warning，独立修订稿为 0。历史报告不重写，零 warning 仅表示本轮已知冲突被处理。

## 编辑时长

旧提示使用“至少增加/压缩一定百分比”，全剧时长与局部编辑场景之间缺少明确额度。第 36 号样本实际经历 61 → 139 → 93 秒，两轮编辑约 215 秒。

新提示复用产品估时器，提供 `duration_budget_seconds`：整集当前时长和目标、固定场景时长、可编辑场景合计时长、目标、推荐区间及允许区间。增减量有上下限，明确这是全部可编辑场景的总额度，不是每场额度；动作和对白并行，中英对照不重复计时，不以动作字数作为旁白时长。固定场景已超过目标时扩大编辑范围，避免局部补丁得到不可达的目标。

以真实初稿回算：整集 61 秒，编辑第 2、3 场为 42 秒，固定第 1 场为 19 秒；编辑部分目标 71 秒，推荐 71–86 秒，允许 56–96 秒。即整集目标增加约 29 秒，最少增加 14 秒、最多增加 54 秒，达到目标后停止扩写。

接受范围仍为 75–115 秒，内部编辑目标落在既有推荐的 90–105 秒区间。未提高最大尝试次数、token 上限或推理强度，也没有增加模型阶段。新反馈属于提示约束，不能保证模型一次到位；原有超限复检和有界失败处理继续保留。

另修复确定性的状态残留：编辑成功与直接通过检查两条路径都会清除旧 deferred 原因/问题及 skip 原因，设置 `script_editor_deferred=false`、`script_editor_quality_status=passed`。原始初稿是否需要编辑的 gate 记录仍保留；这里的 passed 只指编辑契约，不表示人物、证据或整部作品语义验收通过。失败/用尽次数分支仍保留 deferred。

## 显式样本修订

正式目录：`.cache/real-generation-probe/overseas-knowledge-editorial-final-20260908/`。

复用 `scripts/revise_overseas_probe_sample.py`，新增 `--correction-set report36`，固定验证源稿 SHA 后复制 SQLite，拒绝覆盖已有目录。原 report34 为默认选项，其原有 8 处修订已做零调用兼容运行。

| 问题 | 本轮修订 |
| --- | --- |
| S01 | 两人物 time_gap 的 status 由 disproved 显式修订为 known；命题文本和其他未知事实不变 |
| S02 | 第二场滑到次日08:00的动作移至询问前，返回事故20:00的表演提示放到解释该字段的对白 intent 中；动作/对白数量不变 |
| S03 | 中文明确“付款早于通报所载的事故发生时间”，避免混为通报发布时间 |

共 6 个内容字段改变，第一、三场完整不变。每处 before/after、源指纹和修订方法保存在 `revision.json`；新稿清除源模型用量与生成通过标记，仍关联原始 draft 制品。没有把作者编辑当成新模型生成。

修订经过既有 review-draft 重新计算连续性、Story QC 和质量信号，再保存/读回 revised/provisional 制品。两人物正确状态均进入第二集 provisional 检查点、记忆胶囊和实际结构化提示。这里只构造第二集请求，没有调用模型续写。质量审阅仍为 `review_required`。

## 验证证据

| 项目 | 结果 |
| --- | --- |
| 知识诊断、提示和生成服务 | `215 passed`；含 27 个新诊断正反例和 10 个归一化保真用例 |
| 编辑器 | `35 passed`；新增 6 个预算与成功状态用例，既有失败/恢复边界继续通过 |
| 修订脚本 | `7 passed`；来源指纹拒绝、可逆 diff、检查点/召回/提示任一断线均拒绝 |
| 后端全量 | `1134 passed, 1 skipped`；`.cache/overseas-knowledge-duration-backend-20260908.xml` |
| 独立进程复核 | 源稿不变；1 个原 draft/provisional 和 1 个 revised/provisional，来源指针、内容和状态正确 |
| 前端实际双语转换 | 62 个唯一非空路径、0 warning、0 网络调用、输入不变；未宣称 DOM 或浏览器验证 |
| 运行环境 | 后端重启加载修复，两市场资源初始化；API 与前端 200，5 个用户项目完整响应及 `.env.local` 指纹不变 |

本轮没有前端代码修改，未重复全量 UI 测试或 production build。中间工程目录 `overseas-knowledge-editorial-check-20260908` 是问题 ID 去重修复前记录，正式结果以 `editorial-final` 目录为准。

```bash
RUN_REAL_LLM_INTEGRATION=0 .venv/bin/python -m pytest -q \
  --junitxml=.cache/overseas-knowledge-duration-backend-20260908.xml

.venv/bin/python scripts/revise_overseas_probe_sample.py \
  --correction-set report36 \
  --source .cache/real-generation-probe/overseas-three-v2-disclosure-20260908 \
  --output-dir .cache/real-generation-probe/overseas-knowledge-editorial-final-20260908
```

复现修订需使用新的输出目录。原始样本和数据库均保留。

| 文件 | SHA-256 |
| --- | --- |
| 原始第一集 draft.json | `7765ace85f37ae6070c827e1f1ed6b5a037f5853f84b9d2f6986b09c552b0604` |
| revised_draft.json | `8c405352db47a74ca01faa1fd655c925e5fd086e0d2ab14fe125989cda68416c` |
| revision.json | `8ff1c18681a2d317b977766baa57c173470bad6d9bf3723b81513f7823f4767b` |

## 下一项

“已知知识状态修订及后续记忆传递”“编辑时长反馈与成功状态修复”已完成离线验证。下一项是新提示下的有界真实验证，衡量是否减少编辑过冲并完成连续三集；仍使用新样本区分自动生成与人工修订，不沿用本修订稿冒充首集自动质量通过。

三集、八集、完整作品及金额核账仍未通过；本轮未实施认证、租户隔离或无人值守后台任务。
