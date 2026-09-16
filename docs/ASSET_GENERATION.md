# 资产生成与 Provider 接入

## 资产分类

资产使用五个稳定类型：`character`、`scene`、`prop`、`costume`、`audio`。每个资产同时保存结构化 `attributes` 和生成时使用的中文 `prompt`，便于更换模型时重新编译或直接复用提示词。

图片资产支持 `generate` 和 `import` 两种来源，单项资产最多保存三张参考图。常规图片继承项目 `aspectRatio`；人物面部大头照固定为 `1:1`，三视图设定表固定为 `16:9`。

## 人物定稿流程

人物采用有顺序的三阶段流程：

1. **面部定稿**：生成或导入大头照，用户明确设为面部基准后才解锁全身阶段。
2. **全身定稿**：生成任务自动携带已确认面部；可选择腿部比例优化，用户确认全身基准后才解锁三视图。
3. **三视图**：任务自动携带面部和全身两个基准，生成正面、侧面、背面三张独立源图。

三张源图始终保存在任务 `outputs` 中，便于单独重试和后续传给 Seedance。前端默认把它们排成一张 `2400 x 1350` 的三栏 PNG 设定表供预览和下载，也可以切换查看三张源图。旧人物资产在读取时会自动补齐阶段状态和基准图字段。

人物编辑器按“阶段导航 -> 当前阶段参数 -> 生成结果”的顺序排版。面部阶段的真人/动物、性别、年龄和画风选项位于“身份锚点”结果区上方；全身阶段的体型和背景使用同一位置。人物资产卡始终优先使用 `faceReference` 作为封面，即使后续全身或三视图任务更新了资产输出，也不会用全身图覆盖脸部预览。

资产卡、导入参考图、面部/全身候选和三视图源图都可以点击放大。统一预览弹层支持鉴权读取、下载到本地、按钮关闭、点击遮罩关闭和 `Escape` 关闭。人物每个阶段，以及场景、物品、服装编辑器，都提供“后台生成并退出”：前端先保存当前草稿，等待创建任务接口确认入队，再关闭编辑器；建单失败时保留编辑器和错误信息。该操作不等待第三方图片生成完成。

## 可信人像与人脸审核

素材组的上游 `Description` 上限为 300 个字符。两个素材库适配器统一在提交时截取前 300 个 Unicode 字符，项目中完整的人物描述和生图提示词不受影响。2026-09-16 修复此前按 500 字符提交导致的 `Description exceeds 300 characters`，同时保留真实供应商的错误信息，避免重复附加错误的 Dora 前缀。63 项相关回归通过（含 PostgreSQL 自动加白测试），供应商调用使用接口替身；已有失败任务需要在更新后手动重试。

Seedance 2.0 不允许把任意含真人人脸的公网图片或 Base64 直接作为参考素材。TokenAdvent 生成的仿真人图片属于跨平台产物，也不会自动成为 Dora 可信素材。人物在进入视频任务前按来源走两条真实链路：

1. **AI 虚拟人物**：先确认面部基准，我们的 API 生成 30 分钟有效的 HTTPS 下载地址，再通过配置的素材库 Provider 创建 `GroupType=AIGC` 的素材组和图片资源。`CreateAsset` 是异步接口，状态从 `Processing` 变为 `Active` 后才可用于视频；人物编辑器每 5 秒自动刷新，也保留手动刷新；`Failed` 时显示上游 `Error.Code/Message`。
2. **已授权真人**：人物编辑器调用 DoraRouter `CreateVisualValidateSession` 生成一次性 H5 链接和二维码；演员本人打开 H5 完成人脸认证，服务端每 3 秒调用 `GetVisualValidateResult`，拿到 `LivenessFace GroupId` 后自动把当前面部基准创建为真人图片素材。`BytedToken` 只保存在服务端，不返回浏览器；认证会话持久化到 Postgres，刷新页面或切换设备后仍可继续同步。产品不能伪造或代替本人认证。

真人素材建议使用清晰正面图。全身参考图为竖版、人物全身正面；人脸特写图为竖版、正面无表情、肩部以上且面部约占画面三分之二。图片支持 JPEG/JPG/PNG/WebP/GIF/HEIC，小于 30MB，宽高比在 `(0.4, 2.5)`，边长在 300 到 6000px。一个真人素材组只能保存同一演员的不同妆造；每次补充素材都会做人脸一致性校验。

视频和可信素材可以共用 DoraRouter：Seedance 视频和可信人像/加白库默认都走 `https://www.dorarouter.com` 的 Bearer Token，素材库动作使用 `/v1/material?Action=...&Version=2024-01-01`；StringX 与官方 Ark 仍可作为显式回退。旧 MaaS 素材库 `https://maas-ark.stringx.top` 使用一对 Access Key/Secret Key + 火山 SigV4，仅在 `ASSET_LIBRARY_PROVIDER=volc-ark` 时启用。素材的 `ProjectName` 当前默认 `default`，必须与上游工作空间一致：

```dotenv
PUBLIC_API_BASE_URL=https://xumutv.com
ASSET_LIBRARY_PROVIDER=dora-router
DORA_ROUTER_BASE_URL=https://www.dorarouter.com
DORA_ROUTER_API_KEY=
DORA_ROUTER_ASSET_REQUEST_TIMEOUT_MS=300000
VOLC_ASSET_BASE_URL=https://maas-ark.stringx.top
VOLC_ACCESS_KEY=
VOLC_SECRET_KEY=
VOLC_ARK_PROJECT_NAME=default
ASSET_LIBRARY_CONSOLE_URL=
VOLC_ASSET_REQUEST_TIMEOUT_MS=30000
```

`DORA_ROUTER_API_KEY` 同时用于视频和可信素材库，不会复制到前端。健康检查的 `providerNames.assetLibrary` 会显示 `dora-router-material`；如需回滚旧素材接口，改为 `ASSET_LIBRARY_PROVIDER=volc-ark` 并同时配置 `VOLC_ACCESS_KEY` 与 `VOLC_SECRET_KEY`，健康检查会显示 `volc-ark-material`。

自动入库需要 `PUBLIC_API_BASE_URL`。服务端为已确认面部生成 24 小时有效的 HMAC 签名下载地址，DoraRouter 取回素材后异步入库；链接不包含 API Key，过期或篡改后返回 404。localhost 无法被上游访问，临时隧道也可能在 DoraRouter 异步取图前失效，因此正式联调必须使用稳定 HTTPS Demo 域名或对象存储。

人物编辑器的“同步白名单”会先调用 `ListAssetGroups(Filter.GroupType)`，再用得到的 `GroupIds` 调用 `ListAssets`；支持 `AIGC` 虚拟人和 `LivenessFace` 已授权真人。DoraRouter 和旧 VolcArk 适配器共享这一业务契约。同步结果以缩略图卡片展示名称、Asset ID 和处理状态，只允许选择 `Active` 素材，同时保留手动输入 Asset ID 作为兜底。绑定结果会写回人物资产并在重新进入编辑器时恢复，无需重复绑定。绑定后，视频建单把人物引用转换为 `asset://<asset_id>` 并提交给弦序 Seedance。弦序 MaaS 当前返回的 ID 可能以 `maas-` 开头，调度器不能假设固定为 `asset-` 前缀；非弦序视频 Provider 引用 `maas-*` 时会在扣积分前拒绝。

2026-07-20 真实联调确认：`CreateAsset` 成功并返回弦序北京 TOS URL，不等于弦序已成功取到原图。弦序工作人员确认两条测试素材均未上传成功，控制台破损缩略图和长期 `Processing` 是源图获取失败的表现。`Processing` 状态下直接发送 `asset://maas-*` 会返回 `ResourceNotFound (10004)`；发送原始图片或 TOS URL 会返回 `SecurityConstraintViolation (10501)`。必须重新上传并等到 `Active`，不能通过替换 URL 绕过注册。

人物的 `trustedPortrait` 保存非敏感审计字段：Asset ID、Group ID、`AIGC/LivenessFace`、`processing/active/failed`、错误原因和最近校验时间。已 `Active` 的人物在视频请求中使用 `asset://<asset_id>`；分镜图片和资产预览仍使用本地图片 URL。仿真人或已授权真人没有 `Active` 资源时，任务创建接口在积分预扣前返回 `409 TRUSTED_PORTRAIT_REQUIRED`。

相关接口：

- `GET /api/v1/trusted-assets/configuration`
- `GET /api/v1/trusted-assets/portraits?groupType=AIGC|LivenessFace`
- `POST /api/v1/projects/:projectId/assets/:assetId/trusted-portrait/validation-session`
- `GET /api/v1/projects/:projectId/assets/:assetId/trusted-portrait/validation-session/latest`
- `GET /api/v1/trusted-assets/validation-sessions/:sessionId`
- `POST /api/v1/projects/:projectId/assets/:assetId/trusted-portrait/register`
- `POST /api/v1/projects/:projectId/assets/:assetId/trusted-portrait/bind`
- `POST /api/v1/projects/:projectId/assets/:assetId/trusted-portrait/refresh`

## 一键尝鲜资产闭环（遗留 API，当前 UI 未开放）

仓库仍保留 Quick Start Service、API、契约、测试和未挂载的前端弹窗，但当前正式剧本页没有“一键尝鲜”入口。它不是当前客户闭环，也不应从项目库或新功能栈重新暴露，除非先把下面仍使用 `AppStore` 聚合写入的执行路径迁移到 Postgres Repository、Outbox、服务端定价和现有后台任务体系。

遗留设计会先保存用户剧本，再调用文本 Provider 输出 1 到 2 个主要人物、1 到 2 套服装和 1 到 2 个核心场景，不创建物品、音频或次要群演；默认排除仿真人，避免首次体验被真人授权阻塞。

流程分为两个服务端接口：

- `POST /api/v1/projects/:projectId/quick-start/plan`：分析剧本、跳过同类型同名已有资产，返回资产清单、当前队列、套餐并发、预计积分和 45 到 180 秒/批次的等待区间；分析本身暂不扣平台积分，但限制为每分钟最多 6 次，避免无意产生文本 Provider 成本。
- `POST /api/v1/projects/:projectId/quick-start/execute`：校验剧本 SHA-256 指纹，按服务端价格创建资产、积分流水和图片任务。人物面部候选固定 4 积分，服装和场景各 6 积分，前端不能覆盖价格。

执行使用客户端幂等键 `clientRequestId`，重复确认不会重复建单或扣费。当前遗留实现仍在同一个 AppStore 写入批次中处理积分、资产和任务，这是它未重新开放的核心原因。人物任务使用 `generationStage=face` 和 `1:1`，等待用户确认面部后再进入全身/三视图。

## 媒体上传

```http
POST /api/v1/projects/:projectId/media
Content-Type: multipart/form-data
```

表单字段固定为 `file`。图片支持 JPG、PNG、WebP，音频支持 MP3、WAV、OGG 和 MP4 音频，默认单文件上限 10MB。接口返回媒体 ID 和受登录权限保护的 `/api/v1/media/:mediaId` URL。

对象存储由 `ObjectStorage` 隔离：

- `STORAGE_DRIVER=local`：零配置开发，文件写入 `UPLOAD_DIR`
- `STORAGE_DRIVER=gcs`：Demo 环境使用 Google Cloud Storage，通过 ADC 或 `GOOGLE_APPLICATION_CREDENTIALS` 认证
- 正式迁移阿里云时新增 OSS 实现，不修改媒体路由和业务服务

## Img2 接入

当前 `TokenAdventImageProvider` 通过 OpenAI 兼容接口提供真实图片生成：

- `POST /v1/images/generations`：没有参考图的文本生成图片
- `POST /v1/images/edits`：人物面部、全身、三视图等带参考图的一致性生成

两种请求都发送 `moderation: "low"`、`stream: true`、`partial_images: 2`。Provider 支持 JSON URL、`b64_json`、data URL，以及 SSE 中的 `b64_json` / `partial_image_b64`；存在最终图时优先使用最终图，只有最终图缺失时才回退最后一张 partial。远端 URL 由 API 下载后统一写入 `ObjectStorage`，不会把 Provider 鉴权头转发给图片地址。

前端只读取受登录保护的 `/api/v1/generation/tasks/:taskId/outputs/:view`。输入图最多五张（主体图最多一张、其他引用图最多四张），API 会从本地对象存储读取并以 multipart 文件上传，中转密钥、远端 URL 和 Base64 内容不会进入前端状态或项目 JSON。

前端创建图片任务时默认提交 `provider: "img2"`，并包含：

```json
{
  "prompt": "最终中文提示词",
  "negativePrompt": "负面提示词",
  "metadata": {
    "assetId": "asset-id",
    "assetKind": "character",
    "generationStage": "turnaround",
    "aspectRatio": "16:9",
    "sourceMode": "import",
    "references": [
      { "id": "face-id", "url": "/api/v1/media/face-id", "name": "face.png" },
      { "id": "body-id", "url": "/api/v1/media/body-id", "name": "body.png" }
    ],
    "attributes": {},
    "turnaround": true,
    "composeSheet": true,
    "outputLayout": "sheet"
  }
}
```

`generationStage` 的取值为 `face`、`body`、`turnaround`。中转 Provider 应按 `references` 顺序使用已确认基准；三视图返回三个带 `front`、`side`、`back` 视角标识的输出，不需要在 Provider 内提前拼图。

`IMG2_MODEL`、`IMG2_QUALITY` 和 `TOKENADVENT_REQUEST_TIMEOUT_MS` 可以独立调整。适配器实现 `apps/api/src/core/generation/imageProvider.ts` 中的 `ImageGenerationProvider`，更换图片中转时不需要修改任务、资产或前端契约。API Key 只能存在于 API/Worker 环境变量中。

## 剧本生成

正式剧本页的“智能生成”、改写、续写和资产建议会创建 `generation_tasks.kind=text` 后台任务，Worker 的 `scriptTaskHandler` 再调用 `ProjectService`。用户可以离开页面，任务完成后写回项目并由轮询刷新；旧的同步 `POST /script/generate`、`POST /script/enrich` 和 `POST /script/asset-suggestions` 路由仍为兼容入口，不代表当前 UI 会阻塞等待。

智能生成按输入结构和长度处理：少于 1500 个非空白字符且不是多场结构化剧本时，结合项目简介、已确认资产、内容类型和修改意见扩写为约 1800 到 2600 字制作剧本；已经包含至少两个结构化场次时，即使不足 1500 字也按原场次改写，输出数量、编号和顺序必须一致。1500 到 9999 字时保留核心剧情、关系、因果、物件和对白，重写为可分镜格式且禁止压缩成提纲；达到 10000 字时保护原稿，不进行一次性重写。所有剧本输出强制使用简体中文；检测到大量英文句子时，同一任务自动调用一次语言校正，仍不合格则阻止写回并退款。网剧继承 `episodeDurationSeconds`（30 到 300 秒），每场对应一个 4 到 15 秒视频镜头，并包含动作微节拍、配角反应、对白/画外音/内心独白和集尾钩子。

默认文本模型是 `deepseek-v4-flash`。配置 `DASHSCOPE_API_KEY` 后，DeepSeek V4 Flash/Pro 优先走阿里云百炼 OpenAI 兼容接口（`DASHSCOPE_*`，Flash 映射到 `deepseek-v4-flash-0731`）；未配置时才使用旧的 `DEEPSEEK_V4_*` 中转路由。序幕-5.6（`gpt-5.6-sol`）与图片生成使用 `TOKENADVENT_API_KEY`，Kimi/GLM 走 `REHDASU_*` 路由。前端选择的模型会冻结到任务，Worker 必须沿用，禁止悄悄改回默认模型；仅返回 `reasoning_content` 的响应视为格式异常，不能写入剧本或资产建议。

`POST /script/enrich` 的按场次制作字段补齐逻辑仍保留兼容，但当前正式 UI 已把光影、运镜、台词和衔接并入“智能生成”，不再展示独立补齐按钮。原来的场景卡、角色卡、对白段快捷按钮也已移除。

`POST /api/v1/projects/:projectId/script/review` 是会员专属真实审核接口。服务端强制校验用户套餐，调用文本 Provider 并校验结构化 JSON，返回剧情结构、角色动机、对白表演、风格统一、构图执行、光影设计、运镜节奏七个维度的评分、发现和修改建议，以及优先修改项。审核不写入项目正文，前端保留当前页面结果，用户确认修改后再保存剧本。专业审核是辅助意见，不替代编导最终判断。

`POST /api/v1/projects/:projectId/shots/generate` 不调用文本 Provider，提供两种确定性规则模式。默认 `scene` 按非空剧本场次一场生成一个视频镜头，场内 `动作1/动作2/动作3` 作为同一镜头的表演微节拍，不再乘法拆分。高级 `beat` 只拆明确的动作编号、分号或完整句动作；逗号只表示表演细节，不创建新视频；没有明确多动作时不会合成三条假动作，单段对白也只进入一个镜头。每场最多 4 镜，接口全片上限 120 镜。两种模式都不预生成通用演示图片，分镜页另有手动添加入口；完成视频直接在分镜卡片中预览。

## Seedance 2.0 视频接入

Seedance 2.0 只用于 `video` 任务，不参与资产图片生成。当前默认 `VIDEO_PROVIDER=dora-router`，API 服务调用 DoraRouter 的兼容接口。轮询只把明确的成功或失败状态收敛为本地终态；上游返回的其他短暂状态继续按生成中处理，避免远端仍在运行时被本地误判失败：

- `POST https://www.dorarouter.com/doubao/api/v3/contents/generations/tasks`：通过原生 `content` 数组创建任务；旧通用接口要求 `prompt`，不能混用。
- `GET https://www.dorarouter.com/doubao/api/v3/contents/generations/tasks/:taskId`：查询状态和 `content.video_url`。只在明确 `404 task_not_found` 时回读旧 `/v1/video/generations/:taskId`，兼容历史任务；创建请求不跨路径自动重试。
- DoraRouter 文档没有远端取消接口；取消时服务端不反复请求不存在的地址，直接记录 `providerCancelSkippedAt`，并按本地取消规则退款。

StringX Provider 通过 `VIDEO_PROVIDER=stringx` 显式启用，官方火山 Provider 通过 `VIDEO_PROVIDER=volc-ark` 显式启用，均作为回滚通道。DoraRouter 任务记录 `providerName=dora-router-seedance`，便于审计真实提交路径。

分镜页会根据镜头标题和提示词，从已生成的人物、场景、物品和服装中选择最多三项相关资产。人物优先使用已确认全身基准，选择结果写入图片任务的 `references`，并写入图片和视频任务的 `referenceAssetIds`。旧分镜图没有当前资产标记时会显示“需同步资产”，生成视频时忽略这类旧图，直接使用当前资产。

分镜图片不是 Seedance 视频任务的前置条件。没有分镜图时，单镜头和批量入口都直接发送当前匹配的人物、场景、物品和服装；没有任何可用资产时发送纯镜头提示词。如果用户已经主动创建了分镜图任务，视频任务通过 `dependsOnTaskId` 等待它完成并把结果放在资产参考图之前。该图片任务失败时，依赖视频不会提交 Seedance，并自动退回视频预扣积分。

### 分镜连续性

分镜按剧集建立连续链：每集第一镜为 `independent`，后续镜头默认 `continue`；高级动作细拆也沿用同一规则。前端的“连续性工作台”只提供两个易懂选项：

- `独立切镜`：不依赖前一个视频，可以按套餐并发生成，适合时间跳转或场景完全变化。
- `承接上镜`：等待上一镜头完成，由服务端取得上游返回的末帧；DoraRouter 没有独立尾帧地址时由 FFmpeg 从完成视频提取，再放在下一次图片参考首位；同时保留当前镜头选中的人物、场景、物品和服装。

连续模式会把 `continuityMode`、`continuitySourceTaskId`、`dependsOnTaskId` 和 `videoInputMode: "continuity-first-frame"` 写入任务元数据。StringX/Ark 路径按其接口支持 `first_frame` / `last_frame` 语义；DoraRouter 文档只定义 `reference_image`，因此 Worker 将上一镜尾帧作为排序第一的普通参考图，并保留当前镜头资产参考，避免提交未被上游支持的角色值。DoraRouter 完成响应只有 `metadata.url` 时，服务端下载 MP4 并用 FFmpeg 提取末帧后写入对象存储；如果视频地址和尾帧都无法取得，当前镜头会失败并退款，不会静默提交断链任务。

### 服务端质量下限

资产图片和分镜视频的质量约束不是只在前端展示。Worker 在真正调用 Provider 前通过共享包 `packages/prompting/src/qualityRuleCompiler.ts` 编译，当前版本为 `quality-floor-v3`，并把以下审计字段保存到任务：`qualityRuleVersion`、`qualityPresetIds`、`compiledNegativePrompt`、`userNegativePrompt`；图片任务另存 `compiledPositivePrompt`。

人物图片按任务快照 `metadata.attributes.subjectType` 区分人类与动物。明确为 `animal` 的任务保留动物生成能力；`human` 或旧任务缺少该字段时，启用 `human-character` 规则，防止把人类角色或五官肢体生成为动物形态。规则适用于面部、全身、三视图和资产建议后的图片任务，不对场景、分镜、物品或服装施加人类身份限制，也不改变景别或禁止服装上的羽毛装饰。

标准模式提示词明确人类五官与身体结构；高级模式继续保留各阶段的完整自定义提示词，Worker 在最终正向请求加入独立的人类身份约束，不回写到可编辑提示词，避免反复编辑产生重复追加。旧任务缺失资产类型或属性时按同项目、同组织资产补齐。TokenAdvent 图片适配器将内部 `negativePrompt` 合入实际 JSON 或 multipart 请求的 `prompt`，使用“画面约束”标题，避免旧版“避免出现：不要……”的双重否定；即使高级提示词完全覆盖，也会携带质量约束。此处是提示词约束，没有图像物种识别或自动拦截机制；已有错误图片需要重新生成并人工验收。

规则按条件启用：视频通用稳定性、仿真人拍摄设备和背景穿帮、人物五官与手部、场景结构与空场景人物排除、广告产品展示，以及用户自定义负面提示词。动漫/国漫不会误加“禁止动漫”，雾景不会误加“禁止烟雾”，广告允许用户指定的品牌标识。视频 Provider 将质量约束编入最终提示词；图片 Provider 接收内部 `negativePrompt` 后按上游协议提交。规则用于抬高质量下限，不保证每次生成无瑕，仍需人工验收和必要的重试。

生成队列支持单任务暂停、继续和删除。只有本地仍为 `queued` 的任务可以暂停；暂停任务不参与 Worker 调度。删除等待任务时服务端先切换为 `paused`，再软删除并幂等退回预扣积分。运行中的视频仅在 Provider 提供远端 `cancel` 时调用；DoraRouter 当前没有该接口，服务端标记跳过远端取消后按本地规则退款，不会重复请求导致白屏或报错。完成或失败任务删除时只写入 `queueHiddenAt`，不会破坏输出 URL。

分镜卡片展示提示词摘要、参考资产与视频状态，提供带文字的大号“编辑分镜”按钮。已有版本可点“再抽一次”，保留原有版本历史；单镜视频仍为 18 积分，沿用现有连续性和任务队列。批量入口和每个镜头均可在生成前选择 `480p`、`720p`、`1080p` 或 `4k`，选中值冻结到任务 `metadata.resolution`。

“回退到上一版本”直接显示在分镜卡片中。弹窗对比当前使用的视频和将恢复的上一版，标明版本序号与生成时间，确认后只切换 `selectedVideoTaskId`，不创建生成任务、不扣积分、不覆盖当前提示词。上一版按成功任务的生成顺序寻找，可逐次从 V3 回到 V2、V1；“查看版本”中可切回最新版本，也可单独用某一版的原始提示词打开编辑器。生成中禁用切换，没有更早版本时明确提示。回退后镜头预览立即切换，已有完整成片需要重新合成；不会自动重做后续镜头。选定视频缺少尾帧时，单镜连续生成应提示处理，不得悄悄改用别的版本尾帧。桌面/手机回归见 `apps/e2e/tests/web/shot-rollback.spec.js`。

编辑镜头时，提示词上方按人物、物品、场景显示从本镜标题与提示词识别到的项目资产。点击名称写入光标位置；尚无图片的资产也能插入名称，但不会被伪装成可用参考图。画面提示词上限 5,000 字；支持还原打开编辑器时的提示词、本地上传和选择项目参考图。

“使用资产库资产”位于模板入口左侧：图片复用项目媒体导入接口作为本镜参考图（替换当前单张参考图），剧本读取选中版本的全文，可插入全文或选中段落到提示词，不改写项目剧本，超过 5,000 字提示选取更短文本。参考视频的本地上传、URL 入口标为开发中并禁用。

“使用提示词模板”和“存为提示词模板”使用深绿色文字，弹窗保留一致留白，并复用资产库的模板接口；读取选中版本的完整正文，不用摘要代替。模板修改会创建新版本；保存模板不会保存分镜或触发生成。单独保存分镜不扣积分，“保存并生成新版”先保存再用已保存的镜头内容创建任务；失败保留编辑内容，提交期间锁定操作。任务已经受理后，列表或积分刷新失败只提示同步延迟，不把成功提交误报为生成失败。前端回归覆盖见 `apps/e2e/tests/web/shot-editor.spec.js`。

批量入口提供“并发优先”和“连续优先”。并发优先会把已有连续链均衡规划成最多套餐并发数条链，会员最多 3 条、免费用户 1 条；只把新增链首改为 `independent` 并持久化，链内仍按尾帧依赖顺序生成。连续优先完全保留用户现有衔接。后端 Worker 仍是最终并发控制者：会员同一 tick 最多向 Provider 提交 3 个可运行任务，免费用户最多 1 个。队列页显示实际运行数 / 上限。

API 从对象存储读取受保护的分镜图和资产图并转换为 Provider 可读取的图片内容；已激活的可信人物改用 `asset://<asset_id>`。Worker 内部保留 `first_frame/reference_image` 语义，没有图片时只发送提示词。任务用 `videoInputMode` 记录 `storyboard-and-assets`、`assets` 或 `text`，便于排查实际生成路径。请求同时携带模型、项目比例、所选清晰度，并默认请求单镜头音频。网剧镜头限制为 3 到 15 秒，其他内容限制为 4 到 15 秒；建单超时默认 120 秒，建单成功后每 5 秒异步轮询。

承接镜头的上一镜尾帧排在弦序 `content` 图片数组首位，最多仍遵守 9 张图片限制。有当前目标分镜图时提交成对首尾帧；只有上一镜尾帧时使用 `reference_image`，避免触发弦序校验。它不会替代人物/场景的结构化资产，也不会把上一段视频当作当前镜头视频输入。

视频提示词由共享的 `@seqora/prompting` 包编译，当前版本为 `seedance-storyboard-v7`。它保留当前镜头的场次、角色、动作节拍、表情、配角反应、对白/声音意图和必要视觉字段；相邻镜头只提供动作接点，不塞入完整上一场、下一场和超长剧本上下文。前端创建任务时先编译一次，Worker 在真正提交前再按服务端项目数据覆盖编译，旧队列也会自动升级。

成片页默认进入“完整成片”模式，也可以切换到“单镜头”。单镜头只有在 Seedance 任务状态为 `completed` 且存在真实视频 URL 时才渲染 `<video>` 控件；排队、生成和失败状态仅显示分镜参考图与明确状态，不再用静态图模拟视频。

当每个分镜都有已完成的 Seedance 视频后，`POST /api/v1/projects/:projectId/film-preview` 会按分镜顺序创建 `provider: "local-compose"` 的零积分任务。服务端下载对应视频，通过 FFmpeg 统一尺寸、24 fps 和 H.264 编码后拼接成一个 MP4，存入 `ObjectStorage`，再由现有鉴权内容接口提供 Range 播放。项目比例分别输出 `9:16` 的 `720 x 1280`、`16:9` 的 `1280 x 720`、`1:1` 的 `720 x 720`；不同源尺寸使用黑边补齐，不裁切内容。源视频任务 ID 未变化时复用现有预览，任一镜头重新生成后前端会提示重新合成。

该 MP4 是客户检查镜头顺序和节奏的无声视频预览，不再次调用 Seedance，也不扣积分。单镜头 Seedance 视频可能包含模型生成音频，但当前 FFmpeg 使用 `-an` 移除所有音轨；配音、混音、字幕和正式交付导出尚未接入。

第三方任务 ID 只保存在服务端任务 `metadata` 中；前端通过受登录权限保护的 `/api/v1/generation/tasks/:taskId/content` 播放或下载，不接触第三方 API Key。内容接口支持浏览器 Range 播放，并从对象存储或当前 Provider 的完成结果读取媒体。远端提交或生成失败时，任务会保存错误原因并自动退回本次预扣积分，退款账本使用任务 ID 保证幂等。

本地开发在 `apps/api/.env` 配置 `VIDEO_PROVIDER=dora-router`、`DORA_ROUTER_BASE_URL` 和 `DORA_ROUTER_API_KEY`。未配置密钥时开发环境使用本地模拟视频结果；生产环境缺少所选 Provider 密钥会拒绝启动。所有密钥只能通过服务端环境或 Secret Manager 注入，不能写入镜像、前端或 Git。

## 剧本中的角色来源

剧本生成、重写、补全和续写的系统提示词仅使用通用结构示例，角色姓名、身份和换装来自用户素材、已有剧本与已确认资产。此前网剧示例中的固定姓名和医生设定已移除，防止混入无关故事。用户原稿中使用相同姓名仍被保留；不会自动改写已保存的剧本或资产。
