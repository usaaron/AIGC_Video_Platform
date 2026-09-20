# 剧本、资产与分镜资料衔接

记录日期：2026-09-21。本文描述本地候选实现及其验证，尚未部署，不改变 `CURRENT_STATE.md` 中最近的生产发布版本。

## 用户流程

主项目快速剧本交付后，资产页自动读取已保存的剧集，显示「剧本资产」。新人物、场景或物品即使出现在已有资产的项目中，也会以待加入数量提示并自动展开。用户确认名称与资料后执行一次「确认加入资产」，随后可设计形象。读取及展示不创建图片任务、不调用图片或视频 Provider。

分镜页仍由用户执行「生成第 N 集导演分镜」。进入页面、更新资料或确认资产不会自动生成或重新生成分镜。关联资产尚无图片时，镜头标签和编辑器显示「待设计」；记录可以先关联，只有可用的图片或可信人像媒体才进入生成参考列表。分镜图仍不是视频生成的硬前置条件。

## 正文和依据的导入边界

主项目交付沿用 `script_master_delivery.v2`，只交付已保存正文与 `assetEvidence`，不借此直接创建资产卡或镜头。证据结构继续使用 `script_asset_evidence.v1`，新增可选的有序 `scenes` 清单，不是新的导入协议版本。

- `contentHash` 是交付正文 `trim()` 后的 SHA-256；导入时不一致会返回 `IMPORT_ASSET_EVIDENCE_HASH_MISMATCH`，不会存下互相矛盾的正文与依据。
- `scenes` 按实际导出顺序保存 `sourceSceneId` 和原始 `heading`。生成分镜前再次核对正文哈希、完整场次数量及逐项标题顺序，并检查场次 ID 唯一且资产引用没有悬空 ID。
- 资产依据按人物、场景、物品记录名称、明确设定及 `sourceSceneIds`，各类别由 `complete` 分别声明完整性。只有校验通过且该类别完整时，清单才覆盖正文推断；完整空清单会写为「角色：无」或「关键物件：无」。
- 主站存入既有剧集 `continuityState.scriptAssetEvidence`，沿用组织、项目、来源票据、稳定 ID、幂等和制作修订保护，不新增数据库表或迁移。

旧交付缺少 `scenes`、正文已编辑、场次顺序不符、依据损坏或类别不完整时，继续使用已有正文解析。正文解析可以识别正式场景头与对白人物，但不能保证发现仅在动作中出现的沉默角色或物品；这类资料仍可手工补充。导入阶段会拒绝明确的哈希冲突，读取历史数据或分镜生成时则安全回退，不把失效依据当成事实。

## 资产卡复用

`ProjectsService.suggestAssets(..., 'fast')` 使用确定性解析和现有资产匹配，不调用文本模型。默认模型资产分析入口仍是另一条既有能力；本次并未把全部资产分析都改为无需模型。

人物卡复用明确身份、年龄、性别及固定外观；场景卡复用空间、外观和固定布局；物品卡复用外观与固定结构。剧本提供的「外观」和编号「固定细节」在卡片中直接展示，不再错误显示为「未补充」，也不把自由描述强行猜拆成发型等属性。表演方式、声线和本场动作不混入可复用的形象设定；完整创作资料继续保留在剧本侧。

「确认加入资产」沿用 `reuseExisting`：已有同类同名卡优先复用，已设计图片和用户编辑不会被本次读取覆盖。已有卡被标记为已加入，新建议才默认选中。点击刷新仅重读资料；出现新的待加入名称会重新展开，用户手工收起在同一批建议内保持有效。

## 分镜关联和既有制作保护

经校验的场次依据写入镜头提示词的明确字段：

```text
场景：档案室（档案室 - 夜，内景）
角色：林澈、沉默者
关键物件：铜钥匙
动作：原始动作
对白：原始对白
```

场景卡使用稳定地点名复用，原场次的日夜和内外景信息另行保留。正文的长场次拆分继承同一份已校验依据，不截断合法的完整出场清单。

Web 有明确字段时按该类别精确关联：沉默角色不再依赖对白被发现，仅被对白提及的人不会自动入镜；「林」与「林夏」、「Ann」与「Anna」不混配。场景名自身带括号仍可识别，明确的日夜场景版本不会互相替代；找不到场景时不再选资产库中的第一张场景作为兜底。

无图记录和媒体参考分开处理：无图卡仍显示关联，但不消耗媒体参考名额。手工上传参考继续优先保留，已有角色造型选择、可信人像引用及参考数量限制沿用原链路。本次未承诺精确到镜头动作瞬间的角色遮挡或出入画判断，完整清单的来源范围仍是场次。

只有资料变化而正文不变的再次交付可以更新剧集依据并刷新后续资产读取，不重建已有分镜，不改镜头提示词或覆盖图片、视频。正文变更仍使用原有的明确制作修订流程；带媒体或手工修改的制作内容受既有保护，不通过资料刷新绕过。需要新分镜时由用户明确执行生成或修订操作。

## 验证记录

已通过的相关验证：

- Host Web：原有及新增的 6 个相关测试文件、45 项用例；覆盖新建议展开、确认保留、沉默人物、相似姓名、空清单、日夜场景、无图记录、手工参考、造型选择及页面渲染。另补资料卡显示回归 2 项通过；包含既有确认流程的最后定向验证共 2 个文件、5 项通过，重叠用例不重复计数。
- Host API：人物明确年龄及空间属性映射修正后，项目和 Script Master 相关 23 个测试文件、220 项通过。
- Contracts：`project`、`scriptAssetEvidence`、`scriptMaster` 共 3 个文件、20 项通过；共享包构建及 API 类型检查通过。
- 跨仓合成链路调用剧本侧真实导出函数及主站导入、快速资产读取、创建资产和分镜服务，验证 4 张资产卡与 4 个镜头逐场关联。测试使用合成正文与隔离存储，不调用真实付费模型。
- Web lint/build、API build、架构检查、部署安全控制与旧组织路由检查已通过。架构检查仍为既有 16 项历史尺寸例外，本轮未扩大豁免。浏览器验收以最终合并验证记录为准。

已完成的直接 Node 命令，与仓库脚本内容对应；本轮避免触发包管理器自动安装共享依赖：

```powershell
# Host 根目录
node scripts/check-architecture.mjs
node scripts/check-deployment-security.mjs
node scripts/check-deprecated-organization-routes.mjs

# apps/api
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node scripts/copy-migrations.mjs

# apps/web
node node_modules/oxlint/bin/oxlint src
node node_modules/vite/bin/vite.js build
node node_modules/vitest/vitest.mjs run src/features/storyboard/referenceSelector.test.js src/features/storyboard/ShotAssetRecords.test.jsx src/features/assets/DeliveredScriptAssets.test.jsx src/pages/AssetsPage.test.jsx src/pages/StoryboardPage.test.js src/features/script/useAssetSuggestions.test.jsx
node node_modules/vitest/vitest.mjs run src/features/script/AssetSuggestionsPanel.test.jsx
```

本记录不代表已经部署，也不代表生产 PostgreSQL 并发、真实模型质量、真实付费图片/视频生成或全片制作验收。桌面和移动端浏览器 QA 及发布冒烟由本轮总验收补充；发布后应另记实际版本与结果。

## 代码入口

- `packages/contracts/src/scriptAssetEvidence.ts`：依据结构、有序场次和大小限制。
- `apps/api/src/modules/scriptMaster/importPlan.ts`：v2 导入、证据更新与制作保护。
- `apps/api/src/modules/projects/scriptProductionSource.ts`：正文与场次校验及分镜输入准备。
- `apps/api/src/modules/projects/assetSuggestions.ts`：无需模型的建议与明确事实映射。
- `apps/web/src/features/assets/DeliveredScriptAssets.jsx`：剧本资产入口和待加入提示。
- `apps/web/src/features/script/AssetSuggestionsPanel.jsx`：确认加入与资料卡。
- `apps/web/src/features/storyboard/referenceSelector.js`、`shotAssetFields.js`：记录关联、名称匹配和媒体参考筛选。
