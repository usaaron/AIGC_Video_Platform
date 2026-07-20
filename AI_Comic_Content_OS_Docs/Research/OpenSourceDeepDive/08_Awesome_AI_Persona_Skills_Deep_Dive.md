# 08 Awesome AI Persona Skills Deep Dive

## 研究范围与方法

本研究检查 `awesome-ai-persona-skills` 的实际仓库文件，而不是仅依据 README、仓库名称或外部宣传判断能力。

- 参考仓库：`external_research/awesome-ai-persona-skills/`
- 检查日期：2026-07-20
- 检查方式：静态读取目录、Markdown、JSON、Python 与 Shell 文件
- 安全边界：未执行仓库脚本、未安装依赖、未修改参考仓库
- 快照限制：由于 `github.com` 的 Git 连接持续被重置，本地材料来自 GitHub 官方 `codeload.github.com` 的默认分支快照，不包含 `.git` 历史，因此本研究不能引用 commit SHA，也不评估历史版本变化

本研究只讨论当前 Script Generation Box：

`ContentSpec`
→ Prompt Retrieval
→ Prompt Builder
→ `DraftMasterScript`
→ Story QC
→ `RevisionStrategy`
→ `RevisionExecutor`
→ `AcceptanceDecision`

结论默认是：Research only, no current architecture change。

## 1. Repository Inventory

### 1.1 顶层内容

| 路径 | 实际内容 | 判断 |
|---|---|---|
| `README.md` / `README-EN.md` | 仓库定位、功能声明、安装与外部链接 | 项目说明，不是运行时 |
| `persona-skills.md` | 100+ 外部 Persona Skill 链接目录 | Awesome list，不代表这些技能都包含在本仓库 |
| `Novelists/` | 作家人格 Skill 与配套研究材料 | 以指令和内容资产为主 |
| `zimeiti/` | 自媒体人物或机构风格 Skill 与研究材料 | 以指令和内容资产为主 |
| `EQ/` | EQ、SEL 专题 Skill 和长篇指南 | 专业知识型指令资产 |
| `DirectorAgents-1/` | 31 份导演风格资料、总控 Skill、两个 Shell 工具 | 文档资产加轻量关键词工具 |
| `tianya-gods-framework/` | Skill、配置、Python 模板协调器、安装与检查脚本 | 有限的可执行示例，不是真实 LLM 多 Agent 系统 |
| 图片、视频、PDF | 宣传素材与操作指南 | 非运行时资产 |

证据：`README.md`、`persona-skills.md` 以及上述顶层目录。

### 1.2 文件数量与类型

静态盘点结果：

- 总文件数：291
- Markdown：275
- `SKILL.md`：34
- Python：2，其中一个是空的 `__init__.py`
- Shell：5
- JSON：1
- 依赖文件：1 个 `requirements.txt`
- 编译产物：1 个 `.pyc`
- 二进制素材：MOV、PNG、PDF 各 1 个
- 符号链接：未发现

34 个本地 `SKILL.md` 的分布：

| 顶层目录 | `SKILL.md` 数量 | 备注 |
|---|---:|---|
| `Novelists/` | 18 | 包含目录根部的 `Novelists/SKILL.md`；该文件本身也是天下霸唱 Skill，不是 Registry |
| `zimeiti/` | 12 | 人物或媒体机构风格 Skill |
| `EQ/` | 2 | EQ 与 SEL 专题 |
| `DirectorAgents-1/` | 1 | 31 位导演的总控指令；31 份导演资料不是独立 `SKILL.md` |
| `tianya-gods-framework/` | 1 | 20 人智囊团总控指令 |

因此，README 中的“100+ 人格 Skill”不能解释为仓库内有 100+ 个可加载 Skill。`persona-skills.md` 的主要作用是汇总其他 GitHub 项目链接；当前快照实际包含 34 个 `SKILL.md`。

### 1.3 配置、脚本、示例与依赖

实际存在：

- 配置：`tianya-gods-framework/config.json`
- Python 协调器：`tianya-gods-framework/scripts/team-orchestrator.py`
- CLI 包装：`tianya-gods-framework/tianya-gods`
- 安装脚本：`Novelists/install.sh`、`tianya-gods-framework/install.sh`
- 工具与生成脚本：`DirectorAgents-1/scripts/match_directors.sh`、`DirectorAgents-1/scripts/generate_director_skills.sh`
- 包完整性检查：`tianya-gods-framework/test.sh`
- 示例：`DirectorAgents-1/examples.md` 和部分 `SKILL.md` 内联示例
- 研究材料：187 个 `references/` 文件，分布在 33 个 `references/research/` 目录
- 依赖：`tianya-gods-framework/requirements.txt`

未发现：

- 正式 JSON Schema、Pydantic Schema 或统一 Skill Schema
- API、Web 服务、数据库、持久化层
- Skill Registry、动态加载器、路由器
- 单元测试或行为评估数据集
- Prompt 质量 Benchmark
- LLM Provider SDK 或真实模型调用

`requirements.txt` 把 Python 和标准库 `asyncio` 写成了 pip 依赖，并仅把 Pydantic 等列为注释中的可选项，说明依赖管理没有达到可直接复用的工程标准。

### 1.4 License

- 仓库根目录 `LICENSE` 是 MIT License。
- `DirectorAgents-1/LICENSE` 也是 MIT License。
- 34 个 Skill 的 YAML metadata 中没有 `license` 字段。
- `persona-skills.md` 链接的外部项目不自动受本仓库 MIT License 覆盖。
- 名人、作家、导演、自媒体人物的语料、引文、身份与风格模仿还涉及来源真实性、版权、人格权和平台政策问题，不能仅凭仓库 MIT License 判断可安全商用。

## 2. Actual Implementation Classification

### 2.1 实际实现类型

该仓库应分类为：

**以 Agent Skill / Persona 指令集合和研究文档为主体，包含少量独立工具脚本的混合型内容仓库。**

它不是一个统一的 Persona Runtime，也不是完整的多 Agent 编排平台。

主要价值位于：

- 外置的 `SKILL.md` 指令资产
- 人物/风格研究材料
- 心智模型、启发式、表达模式、反模式与边界描述
- 目录组织和内容拆分方式

有限运行时代码位于：

- `tianya-gods-framework/scripts/team-orchestrator.py`
- `DirectorAgents-1/scripts/match_directors.sh`
- 安装、启动和包检查脚本

### 2.2 实际实现与文档声称的差异

| README / 配置声称 | 实际文件证据 | 结论 |
|---|---|---|
| 100+ Skill 可直接使用 | 仓库内只有 34 个 `SKILL.md`；其余大多是 `persona-skills.md` 外链 | 100+ 更接近索引规模，不是本地实现规模 |
| DirectorAgents 提供 31 位导演多 Agent 协作 | 有 31 份导演 Markdown 资料和一个总控 `SKILL.md`，但没有模型调用、Agent Runtime、投票状态机或协作执行器 | 主要是协作模式说明与内容资产 |
| Tianya 提供 20 位大神并行智能分析 | Python 使用 `asyncio.gather` 并行调用本地模板函数，但 `god_analyze()` 明确注释“实际应调用 AI 模型” | 并行框架可运行，分析内容仍是占位模板 |
| 支持共识、分歧、风险和行动方案 | 对应函数返回固定字符串，如“共识点1”“建议...” | 输出结构存在，语义分析未实现 |
| Python API 可 `from scripts.team_orchestrator import ...` | 实际文件名是 `team-orchestrator.py`，与下划线 import 路径不一致 | 配置文档中的 API 示例不能直接按原样导入 |
| 统一 Skill 规范 | 34 个 Skill 都有 `name/description/type/author`，但只有 18 个有 `version`、16 个有 `created`，且没有统一 schema | 存在共同习惯，不是经过机器校验的统一契约 |

证据：`README.md`、`persona-skills.md`、`DirectorAgents-1/SKILL.md`、`tianya-gods-framework/config.json`、`tianya-gods-framework/scripts/team-orchestrator.py`。

## 3. Representative File Analysis

### 3.1 作家 Persona：张爱玲 Skill

路径：`Novelists/zhangailing-skill/SKILL.md`

实际结构：

- YAML metadata：`name`、`description`、`version`、`type`、`author`、`created`
- 身份卡和创作信条
- 问题分类与研究触发条件
- 多个心智模型，每个模型包含定义、应用、证据与局限性
- 决策启发式、表达 DNA、价值观、反模式、内在张力
- 能力边界、知识边界和来源说明

输入假设是用户会通过自然语言触发某位作家的视角或写作方式；输出没有机器可校验 schema。失败处理没有标准机制，只有“诚实边界”和局限性说明。

可借鉴的是“原则 + 适用方式 + 证据 + 局限 + 反模式”的知识表达结构。不可直接借鉴的是对具体作者身份、文风和表达的模仿。

### 3.2 专业知识型 Skill：SEL

路径：`EQ/sel-social-emotional-learning-skill/SKILL.md`

实际结构：

- YAML metadata
- 专家身份、回答风格、回答结构、边界设定
- 问题分类、知识检索维度和分步回答工作流
- 基于 CASEL 的心智模型、适用方式与局限性
- 价值观、反模式、诚实边界和研究来源

与名人 Persona 相比，该文件更接近“专业能力说明”，因为它围绕可陈述框架组织，而不是只模仿某个人的口吻。它仍然没有运行时验证、标准输入输出模型或引用解析机制。

### 3.3 自媒体 Persona：秋芝 2046

路径：`zimeiti/qiuzhi2046-skill/SKILL.md`

实际结构：

- 身份轨迹和平台数据叙述
- 内容问题分类与输出流程
- 痛点、实测、One-Click 等心智模型
- 七条内容创作启发式
- 不同平台的节奏公式和表达 DNA
- 价值观、反模式与诚实边界

该文件展示了把“内容风格”拆成可复用决策规则、节奏和反模式的方法。但人物数据和平台数据没有机器可验证的来源记录，且内容存在明显的人格注入和口吻复刻意图。

### 3.4 导演总控 Skill

路径：`DirectorAgents-1/SKILL.md`

实际结构：

- 31 位导演风格表
- 顺序链、辩论投票、主席团三种概念协作模式
- 需求类型到导演组合的匹配表
- 输出结构、心智模型、启发式和反模式
- 诚实边界与调研来源

但实际辅助脚本 `DirectorAgents-1/scripts/match_directors.sh` 只是固定关键词匹配并打印推荐组合；它没有加载 31 个 Agent、没有调用 LLM、没有辩论或投票。`generate_director_skills.sh` 是批量写 Markdown 模板的脚本，并且路径使用带引号的 `~/Downloads/...`，存在 shell 路径展开问题。

### 3.5 Tianya 多角色框架

路径：

- `tianya-gods-framework/SKILL.md`
- `tianya-gods-framework/config.json`
- `tianya-gods-framework/scripts/team-orchestrator.py`
- `tianya-gods-framework/test.sh`

实际 Python 代码定义了角色枚举、角色资料、分析结果和异步聚合流程。它可以组织 20 个协程并生成结构化文本报告，但每个角色的观点、关键点、建议、共识、分歧和风险都由固定字符串模板产生，置信度固定为 `0.85`。

`test.sh` 只检查文件、目录、执行权限、JSON 可解析和 Python 可编译，不测试分析质量、路由正确性或多角色协作行为。

因此，这是一个可执行的演示骨架，不是可验证的多 Agent 智能系统。

## 4. Skill Schema Findings

### 4.1 Metadata 一致性

对 34 个 `SKILL.md` 的静态统计：

| 字段 | 文件覆盖数 | 结论 |
|---|---:|---|
| `name` | 34 | 共同字段 |
| `description` | 34 | 共同字段 |
| `type` | 34 | 共同字段，但取值未见 schema 校验 |
| `author` | 34 | 共同字段 |
| `version` | 18 | 非统一必填 |
| `created` | 16 | 非统一必填；部分文件改用中文 `调研时间` |
| `license` | 0 | 未进入 Skill metadata |

仓库没有 schema 文件或 validator，因此这些字段只是内容习惯，不能直接作为 AI Comic Content OS 的稳定数据契约。

### 4.2 Persona 能力字段

以下是正文标题或关键词覆盖率，不代表标准化字段：

| 能力概念 | 覆盖数（34） | 判断 |
|---|---:|---|
| 核心身份 / 身份卡 | 31 | 常见，但不是 schema |
| 决策启发式 | 33 | 最稳定、最值得研究的内容模式之一 |
| 表达 DNA | 33 | 常见，适合抽象成中性 Speech Pattern，而非名人模仿 |
| 诚实边界 | 30 | 常见，但主要是文本声明 |
| 反模式 | 28 | 可支持未来 QC / Revision 的负向约束 |
| 内在张力 | 23 | 可用于角色矛盾设计，但覆盖不完整 |
| 局限性 / 能力边界 / 知识边界 | 27 | 有助于限制适用范围 |
| 明确输出格式 / 回答结构 | 5 | 大多数输出不可机器验证 |
| 标准失败处理 / fallback | 0 | 没有统一失败协议 |

针对任务关心的具体维度：

- Identity：多数文件有。
- Motivation / Goals：没有稳定字段；部分文件以创作信条、价值观、适用场景代替。
- Decision Patterns：大量文件有决策启发式或问题分类。
- Speech Patterns：大量文件有表达 DNA、句式和节奏描述。
- Emotional Boundaries：EQ 类文件有明确边界，Persona 文件多为“诚实边界”；没有统一的情绪边界数据结构。
- Contradictions：部分文件用“内在张力”表达，但不是全仓统一字段。
- Anti-patterns：多数文件有明确反模式。
- Limitations：多数文件有文本局限性，但不能被运行时自动执行。

### 4.3 输入、输出和失败处理

- 输入通常是假设用户自然语言触发词，而不是结构化 Request。
- 输出通常是自然语言回答结构，而不是 JSON Schema。
- 约束主要依赖正文指令，没有 validator。
- 示例数量有限，且不是可复现测试 fixture。
- 失败处理、缺失信息处理、冲突解析和安全 fallback 没有统一定义。
- Framework 依赖主要通过文字声称兼容 StepClaw / OpenClaw / ClawTeam；仓库没有统一适配层。

## 5. Runtime Findings

### 5.1 实际存在的运行行为

- `team-orchestrator.py`：异步执行 20 个本地模板分析并拼装报告。
- `tianya-gods`：调用 Python 文件的 CLI wrapper。
- `match_directors.sh`：根据固定关键词打印导演组合。
- `generate_director_skills.sh`：批量生成最小 Skill Markdown。
- `install.sh`：把文件复制到 StepClaw 目录或下载另一仓库。
- `test.sh`：检查安装包完整性和语法。

### 5.2 不存在的运行能力

- 不存在真实 LLM 调用。
- 不存在统一 Skill Loader 或 Registry。
- 不存在基于 metadata 的动态路由。
- 不存在 Agent 状态、消息总线、辩论、投票或结果裁决实现。
- 不存在 API、持久化、权限、审计或版本迁移。
- 不存在对输出 schema 的验证与重试。
- 不存在 Story / Persona 质量评估和回归 Benchmark。

### 5.3 Runtime 结论

仓库同时包含内容资产和少量可执行代码，但两者没有形成统一基础设施。可执行部分主要是确定性演示、安装工具和模板生成器，不能支持 README 所描述的完整多 Agent Persona 平台。

## 6. Script Generation Compatibility

| 当前模块 | 概念兼容点 | 可接受边界 | 不兼容点 |
|---|---|---|---|
| `ContentSpec` | 人物动机、关系张力、表达约束可以成为上游明确需求 | 只接收经过治理和类型化的引用 | 不直接放入名人 Persona 文本或自由 Skill |
| Prompt Retrieval | 可借鉴按类别、适用场景和触发条件检索外置能力资产 | Prompt 仍来自现有 Prompt Library | 不新增独立 Skill Registry，不让外部 Skill 接管检索 |
| Prompt Builder | 可消费中性的角色行为约束、表达边界、反模式 | 通过版本化 Knowledge / Prompt 资产进入 | 不把整个 `SKILL.md` 原样拼入 Master Prompt |
| `DraftMasterScript` | Identity、Motivation、Decision Pattern、Speech Pattern 可启发角色结构 | 使用原创角色与可追踪约束 | 不模仿名人、作家或导演身份和受保护风格 |
| Story QC | 反模式、局限、决策启发式可启发角色一致性和对白区分度证据 | 需先形成独立知识条目并通过 Benchmark 验证 | 仓库自身没有评分 Rubric，不能直接作为 QC Ground Truth |
| `RevisionStrategy` | “问题 + 原因 + 方法 + do-not-touch”与 Skill 的启发式/反模式结构有概念相似性 | 只引用经过治理的中性 `knowledge_ref` | 不使用 Persona 指令进行无边界改写 |
| `RevisionExecutor` | 当前仓库没有可直接复用的受控修订执行器 | 保持现有 Executor 边界 | 不引入其脚本或多 Agent 宣称 |
| `AcceptanceDecision` | 无直接可借鉴实现 | 继续使用当前确定性指标 | 仓库没有 revision effectiveness 或验收机制 |

最合理的概念流仍然是：

Knowledge
→ 受治理的 Creative Capability
→ Prompt Library / Prompt Builder
→ `LLMAdapter`

这只是未来研究方向，不构成本轮架构变更，也不要求新增 Creative Skill Layer。

## 7. Safe Concepts to Borrow

以下概念均由实际文件证明，但只建议借鉴设计思想，不复制源文件：

1. **能力指令外置**：使用独立 Markdown 管理身份、工作流、限制和输出要求，避免业务代码散落长 Prompt。证据：各目录 `SKILL.md`。
2. **原则与证据并列**：心智模型同时记录定义、应用方式、来源证据与局限性。证据：`Novelists/zhangailing-skill/SKILL.md`、`EQ/sel-social-emotional-learning-skill/SKILL.md`。
3. **启发式与反模式配对**：既说明应该怎么做，也说明不应该怎么做。证据：`Novelists/`、`zimeiti/` 多个 Skill。
4. **表达特征结构化拆分**：把节奏、句式、信息密度和措辞倾向拆开描述。证据：`zimeiti/qiuzhi2046-skill/SKILL.md` 的“表达DNA”。
5. **角色内在张力**：用成对矛盾描述角色的稳定冲突来源。证据：`Novelists/zhangailing-skill/SKILL.md` 的“内在张力”。
6. **研究材料与激活指令分离**：核心 `SKILL.md` 与 `references/research/` 分开保存。证据：33 个 `references/research/` 目录。
7. **明确能力边界**：记录不能做什么、信息截止时间和适用限制。证据：EQ、SEL、作家与导演 Skill 的边界章节。
8. **输出结构先行**：即使 Tianya 的语义仍是模板，它把共识、分歧、风险和行动方案拆成独立输出字段的思路可供参考。证据：`tianya-gods-framework/scripts/team-orchestrator.py`。

如果未来验证这些概念，应先转化为原创、去人格化、版本化的知识条目，再通过现有 Benchmark 验证其对 Character Consistency、Dialogue Quality 或 Revision Effectiveness 的真实提升。

## 8. Concepts Not to Borrow

1. **名人、作家、导演直接模仿**：不采用“我是某人”或“像某人那样写/拍”的人格注入，也不复刻标志性口吻。
2. **未经治理的 Persona 注入**：不把任意 `SKILL.md` 直接拼入 Prompt Builder，避免约束冲突、Prompt Injection 和不可追踪行为。
3. **巨大 Skill Marketplace / Registry**：当前 34 个 Skill 已存在元数据不一致；扩大规模只会放大版本、来源、适用性和质量治理成本。
4. **多 Agent 扩张**：DirectorAgents 的三种协作模式主要停留在文档，Tianya 的并行分析是固定模板；这些证据不足以支持引入多 Agent 架构。
5. **框架特定安装方式**：不采用写入 `~/.stepclaw`、创建 symlink、下载其他仓库或硬编码本机目录的安装脚本。
6. **无 schema 的自由文本契约**：不把 YAML 习惯当作稳定模型；任何未来知识或能力对象都必须有类型、版本与校验。
7. **Prompt 重复**：不为每个角色复制大量相同工作流文本；应复用现有 Prompt Library 和 Knowledge 引用。
8. **身份刻板化**：不把人物简化成固定标签、名言和表层语气，避免角色扁平化、文化刻板印象和错误归因。
9. **未验证的事实和引文**：仓库研究材料没有统一 citation ID、校验流程或来源抓取记录，不可直接作为专业 Story QC 依据。
10. **License 过度推断**：根 MIT License 不等于所有外链内容、引文、人物身份和风格模仿都可无风险使用。

## 9. Evidence Paths

### 仓库定位与规模声明

- `external_research/awesome-ai-persona-skills/README.md`
- `external_research/awesome-ai-persona-skills/README-EN.md`
- `external_research/awesome-ai-persona-skills/persona-skills.md`

### 代表性 Skill

- `external_research/awesome-ai-persona-skills/Novelists/zhangailing-skill/SKILL.md`
- `external_research/awesome-ai-persona-skills/Novelists/SKILL.md`
- `external_research/awesome-ai-persona-skills/zimeiti/qiuzhi2046-skill/SKILL.md`
- `external_research/awesome-ai-persona-skills/EQ/eq-skill/SKILL.md`
- `external_research/awesome-ai-persona-skills/EQ/sel-social-emotional-learning-skill/SKILL.md`
- `external_research/awesome-ai-persona-skills/DirectorAgents-1/SKILL.md`
- `external_research/awesome-ai-persona-skills/tianya-gods-framework/SKILL.md`

### 研究材料与导演资料

- `external_research/awesome-ai-persona-skills/Novelists/zhangailing-skill/references/research/`
- `external_research/awesome-ai-persona-skills/zimeiti/qiuzhi2046-skill/references/research/`
- `external_research/awesome-ai-persona-skills/DirectorAgents-1/directors/王家卫.md`
- `external_research/awesome-ai-persona-skills/DirectorAgents-1/references/01-core-research.md`

### 运行时、工具和检查

- `external_research/awesome-ai-persona-skills/tianya-gods-framework/scripts/team-orchestrator.py`
- `external_research/awesome-ai-persona-skills/tianya-gods-framework/config.json`
- `external_research/awesome-ai-persona-skills/tianya-gods-framework/requirements.txt`
- `external_research/awesome-ai-persona-skills/tianya-gods-framework/test.sh`
- `external_research/awesome-ai-persona-skills/tianya-gods-framework/install.sh`
- `external_research/awesome-ai-persona-skills/DirectorAgents-1/scripts/match_directors.sh`
- `external_research/awesome-ai-persona-skills/DirectorAgents-1/scripts/generate_director_skills.sh`
- `external_research/awesome-ai-persona-skills/Novelists/install.sh`

### License

- `external_research/awesome-ai-persona-skills/LICENSE`
- `external_research/awesome-ai-persona-skills/DirectorAgents-1/LICENSE`

## 10. Open Questions

1. 这些 Skill 的引用、人物数据和引文是否有可复核的逐条来源？当前文件没有统一 source ID 或 provenance schema。
2. README 所称 AgentSkills 兼容性是否通过任何官方 validator？当前仓库未提供验证结果。
3. 外链 Skill 的许可证、维护状态和安全边界是否经过统一审查？当前 awesome list 只提供链接。
4. Persona 风格约束对真实剧本的 Character Consistency 和 Dialogue Quality 是否有可重复提升？仓库没有 Benchmark。
5. 角色内在张力、决策启发式和表达边界能否去人格化后形成原创角色知识？需要单独 Research 和小样本评估。
6. 导演/作家资料中的引文和归因是否准确？在没有来源校验前不能进入 Knowledge Base。
7. 当前快照没有 Git 历史；如果未来需要追踪变更，应在网络条件允许时记录正式 commit SHA 后重新复核。

## 11. Roadmap Impact

### 当前影响

- Research only, no current architecture change。
- 不改变 Script Generation Box Contract。
- 不新增 Skill Registry、Agent Workflow 或 Persona Module。
- 不改变当前 Story QC、Revision、Acceptance 和 Finalization 边界。
- 不改变当前 Capability Optimization 优先级。

### 未来可验证研究方向

只有在当前 Revision Quality Improvement checkpoint 完成后，才值得用固定 Benchmark 小范围验证以下中性抽象：

- 原创角色的 decision patterns 是否提升 Character Agency 与 Consistency
- 中性 speech patterns 是否提升对白区分度
- anti-patterns 与 limitations 是否能生成更可执行的 Story QC evidence
- internal tensions 是否能提升角色冲突和情绪推进

任何实验都必须先形成版本化知识条目，通过 Prompt Evaluation / Story QC / Revision Effectiveness 对比证明收益，再决定是否进入正式设计。

## 结论

`awesome-ai-persona-skills` 最有价值的不是“100+ 人格”或“多 Agent”宣传，而是它在实际 Skill 文件中反复使用的内容拆分方式：身份、决策启发式、表达特征、反模式、内在张力、来源和边界。

这些结构可以启发 AI Comic Content OS 对原创角色行为知识的未来研究，但仓库本身没有提供统一 schema、真实 Skill Runtime、质量评估或可验证多 Agent 能力。当前最稳妥的做法是只吸收去人格化、可治理、可版本化的知识表达方法，不复制人物模仿内容，不引入其运行脚本，也不调整现有路线图。
