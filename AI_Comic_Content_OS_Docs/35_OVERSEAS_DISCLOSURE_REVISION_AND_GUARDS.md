# 海外公开状态一致性与样本修订

日期：2026-09-08（Asia/Shanghai）。范围：处理第 34 号报告的 S01–S03，并验证修订事实进入后续请求。

## 结果

三项已知问题已在独立编辑修订稿中处理：付款截图的宴会展示范围、名单预览的屏幕指代、追查名单的对白主体。原稿和历史验收结论保留，修订制品为 `revised` / `provisional`，通过 `source_artifact_id` 指向原始草稿。本轮没有真实模型调用、没有新增生成费用，也没有生成第二或第三集。

产品补齐公开状态提示约束和保守的非阻断诊断。新检查器对原始样本报告 1 条公开状态冲突，修订稿该项为 0；真实产品复检、持久化读回、第二集请求构造和前端双语转换均通过。后端全量 `1084 passed, 1 skipped`。这些结论支持已知问题修订完成，不能证明未来模型会自动生成无语义问题的三集。

## 产品改动

`TemplatePromptBuilder` 的两个 EpisodeContext 路径共用 `EvidenceDisclosureContract`，要求分别记录各份材料的持有和公开状态，明确操作端预览、观众大屏、网络发布以及可确认的受众。中断展示不能抹掉已展示内容；部分材料公开不能推导其余材料也公开，显示开启也不能推导所有人已经读懂。

现有正文编辑和语言修复提示保留行为主体、具体动作及公开范围，不能把“追查名单”弱化为无主体结果，也不能擅自补出执行者、设备或受众。编辑模型的输出权限没有扩展到任意改写账本，没有增加模型阶段或自动语义 Gate。

`continuity_qc.py` 增加同集 warning：只有状态包含独立、未限定渠道的“未公开/未曝光”等声明，同时动作文本明确出现指定公共场所屏幕的肯定展示，且材料名称能唯一对应，才给出 `knowledge_conflict`。使用现有问题类型，不新增公共枚举，不改 blocking 门禁或自动覆盖状态。

诊断采用有限中文/英文表达模式，明确排除已识别的计划、条件、否定、转述、引用、非当前时间线、无人场地、遮挡和彩排等情形。中文简称必须至少四字且对本集材料集合唯一；私人屏幕、裸类别名及多份材料共用简称不据此归因。限定为“尚未在网络公开”的状态可以与宴会展示同时成立。

该检查不是通用语义引擎：同义改写、复杂跨句指代、未显式写出的受众、任意发布渠道仍可能漏检，零警告不能充当全面质量保证。历史已保存报告不被静默重写，需通过重新审阅得到新诊断。

## 可追踪修订

源目录：`.cache/real-generation-probe/overseas-single-v2-guards-20260908/`。

正式修订目录：`.cache/real-generation-probe/overseas-single-editorial-final-20260908/`。

脚本 `scripts/revise_overseas_probe_sample.py` 只接受第 34 号样本的精确指纹，拒绝覆盖已有输出目录；用 SQLite backup 在独立目录复制数据库，之后所有 API 写入只针对副本。每处 before/after、来源指纹、时间和编辑方式保存在 `revision.json`，修订稿没有沿用原始模型成功标志或用量作为本次生成记录。

| 问题 | 修订内容 |
| --- | --- |
| S01：付款截图展示与未公开冲突 | 账本明确“曾短暂显示在宴会大屏”，并将网络发布保留为未有证据；原因记录展示后拔线，保留证人名单未展示的独立事实 |
| S02：名单在何处可见 | 开场明确名单只在讲台操作端预览中被选中，尚未上大屏；亚当的英文和中文对白同步改为即将投出的预览内容 |
| S03：追查名单的行为主体 | 英文明确进一步发到网上这一渠道，中文保留“他们就会追查名单”的行为与主体 |
| 同一修订的证据措辞 | 名单保管原因由“收入口袋”对齐实际动作“锁入手机加密夹” |

共 8 处内容字段修改；ID、时间、编辑 provenance 和重新计算的诊断另记。第二、三场完整内容未改，仍为 3 场、16 项动作、30 对对白；全部 `body_order` 不变。修订属于显式编辑选择，操作端预览和网络渠道的澄清不是对原稿未写内容的追溯证明。

修订稿调用产品既有 `/script-generation/review-draft`，重新计算连续性、Story QC、修订计划及质量审阅信号，然后保存 `revised` / `provisional` 制品。源草稿在副本中也保留，校验内容不变；原始目录全部既有文件指纹检查不变。质量审阅仍可能提示 `review_required`，这些非语义信号不因本轮局部修订而被改成全局放行。

## 后续记忆验证

使用产品 TypeScript 状态投影更新副本 Workspace，保存并读回一致。第二集通过现有 `build_probe_request` 构造，provisional 检查点覆盖到第 1 集；付款截图的展示范围进入 `world_states`，并在实际结构化提示词中保留。

- `projected_workspace.json`：修订状态和独立修订制品引用。
- `episode_002_request.json`、`episode_002_structured_prompt.txt`：第二集只构造请求，未调用模型。
- `revision_artifact.json`：指向原始草稿的修订 lineage。
- `review_run.json`：产品编辑后复检结果；源生成上下文仍可追踪，不代表发生新的生成。
- `original_qc_rechecked.json`、`revised_qc.json`：在新检查器下原稿 1 条 warning、修订稿 0 条。

后续请求包含修正状态证明接线有效，不能证明尚未执行的第二集会遵守该状态，也不能替代跨集正文验收。

## 验证与复现

| 验证 | 结果 |
| --- | --- |
| 连续性、生成提示及编辑专项 | `103 passed`；新增 21 个公开状态正反例 |
| 后端全量 | `1084 passed, 1 skipped`，29.71 秒；1 条已有 TestClient 依赖弃用警告 |
| 副本端到端修订脚本 | 0 次模型请求；产品复检、源制品不变、修订保存/读回、Workspace 和第二集状态传递通过 |
| 独立进程只读复核 | 原始草稿与修订制品均为 provisional，来源指针和内容一致；第二三场及表演顺序保持 |
| 前端实际双语转换 | 62 个唯一非空展示路径、0 警告、0 网络请求、输入不变 |
| 本地运行 | 后端重启加载修复，大陆及海外资源恢复；重启前没有运行中 Agent |

真实集成测试显式关闭；本轮没有前端代码改动，未重复全部 UI 测试或 production build。后端全量证据为 `.cache/overseas-disclosure-backend-20260908.xml`。脚本首次隔离验证目录 `overseas-single-editorial-revision-20260908` 是中间工程记录，正式结果以上述 `editorial-final` 目录为准。

```bash
RUN_REAL_LLM_INTEGRATION=0 .venv/bin/python -m pytest -q \
  --junitxml=.cache/overseas-disclosure-backend-20260908.xml

.venv/bin/python scripts/revise_overseas_probe_sample.py \
  --source .cache/real-generation-probe/overseas-single-v2-guards-20260908 \
  --output-dir .cache/real-generation-probe/overseas-single-editorial-final-20260908
```

复现脚本需要 Node.js、本地 Python 依赖和源样本，不需要模型凭据。输出目录已存在时必须换新目录。

| 文件 | SHA-256 |
| --- | --- |
| 原始 `episode_001/draft.json` | `76a7c9f5fa9831a4f40cff53a212f3a4e6ac41c7ef836955388b2a1426b3bf09` |
| 正式 `revised_draft.json` | `09ea4a94f88594b02bd27e1389ed9da47f9c7f9c432852221c276f0a134340da` |
| 正式 `revision.json` | `0eacf00008396310b2b4dc89e01f1922dcd6781b8e21e67cffed8c38d17f3388` |

## 下一项

本轮把“已知三项问题修订”和“第二集状态传递”标为完成。下一项恢复海外 v2 三集真实验收，使用新产品提示与诊断，沿用已授权的最多 6 次请求、15 分钟。修订稿不能冒充新提示生成的首集或用于抬高自动生成通过率；若未来选择从修订稿续写，必须单独注明作者编辑介入。

三集通过前不进入八集；金额核账、完整作品验收及认证/租户隔离/无人值守仍待处理。本轮没有证明这些后续能力已完成。
