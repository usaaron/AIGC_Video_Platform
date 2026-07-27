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

Seedance 2.0 不允许把任意含真人人脸的公网图片或 Base64 直接作为参考素材。TokenAdvent 生成的仿真人图片属于跨平台产物，也不会自动成为弦序可信素材。人物在进入视频任务前按来源走两条真实链路：

1. **AI 虚拟人物**：先确认面部基准，我们的 API 生成 30 分钟有效的 HTTPS 下载地址，再通过弦序 MaaS 创建 `GroupType=AIGC` 的素材组和图片资源。`CreateAsset` 是异步接口，状态从 `Processing` 变为 `Active` 后才可用于视频；人物编辑器每 5 秒自动刷新，也保留手动刷新；`Failed` 时显示上游 `Error.Code/Message`。
2. **已授权真人**：制作方在方舟体验中心创建真人资产组和邀约二维码；演员本人登录火山账号完成人脸认证、上传素材并授权；制作方在控制台接收素材后，把得到的 Asset ID 粘贴到人物编辑器校验绑定。`LivenessFace` 只能通过控制台创建和授权，OpenAPI 只支持查询，产品不能伪造或代替本人认证。

真人素材建议使用清晰正面图。全身参考图为竖版、人物全身正面；人脸特写图为竖版、正面无表情、肩部以上且面部约占画面三分之二。图片支持 JPEG/JPG/PNG/WebP/GIF/HEIC，小于 30MB，宽高比在 `(0.4, 2.5)`，边长在 300 到 6000px。一个真人素材组只能保存同一演员的不同妆造；每次补充素材都会做人脸一致性校验。

视频和可信素材全走弦序，但使用两个弦序入口和两种凭证：Seedance 视频接口 `https://maas.stringx.top/api/v3` 使用 `sk-` Bearer Token，MaaS 素材库 `https://maas-ark.stringx.top` 使用一对 Access Key/Secret Key + 火山 SigV4。两类弦序凭证必须属于同一租户/项目，素材的 `ProjectName` 当前默认 `default`。服务端变量：

```dotenv
PUBLIC_API_BASE_URL=https://studio.example.com
VOLC_ASSET_BASE_URL=https://maas-ark.stringx.top
VOLC_ACCESS_KEY=
VOLC_SECRET_KEY=
VOLC_ARK_PROJECT_NAME=default
ASSET_LIBRARY_CONSOLE_URL=
VOLC_ASSET_REQUEST_TIMEOUT_MS=30000
```

自动 AIGC 入库需要 `PUBLIC_API_BASE_URL`。服务端为已确认面部生成 24 小时有效的 HMAC 签名下载地址，弦序 MaaS 取回素材后异步入库；链接不包含 API Key，过期或篡改后返回 404。localhost 无法被上游访问，临时隧道也可能在弦序异步取图前失效，因此正式联调必须使用稳定 HTTPS Demo 域名或对象存储。

人物编辑器的“同步白名单”会先调用 `ListAssetGroups(Filter.GroupType)`，再用得到的 `GroupIds` 调用 `ListAssets`；支持 `AIGC` 虚拟人和 `LivenessFace` 已授权真人。同步结果以缩略图卡片展示名称、Asset ID 和处理状态，只允许选择 `Active` 素材，同时保留手动输入 Asset ID 作为兜底。绑定结果会写回人物资产并在重新进入编辑器时恢复，无需重复绑定。绑定后，视频建单把人物引用转换为 `asset://<asset_id>` 并提交给弦序 Seedance。弦序 MaaS 当前返回的 ID 可能以 `maas-` 开头，调度器不能假设固定为 `asset-` 前缀；非弦序视频 Provider 引用 `maas-*` 时会在扣积分前拒绝。

2026-07-20 真实联调确认：`CreateAsset` 成功并返回弦序北京 TOS URL，不等于弦序已成功取到原图。弦序工作人员确认两条测试素材均未上传成功，控制台破损缩略图和长期 `Processing` 是源图获取失败的表现。`Processing` 状态下直接发送 `asset://maas-*` 会返回 `ResourceNotFound (10004)`；发送原始图片或 TOS URL 会返回 `SecurityConstraintViolation (10501)`。必须重新上传并等到 `Active`，不能通过替换 URL 绕过注册。

人物的 `trustedPortrait` 保存非敏感审计字段：Asset ID、Group ID、`AIGC/LivenessFace`、`processing/active/failed`、错误原因和最近校验时间。已 `Active` 的人物在视频请求中使用 `asset://<asset_id>`；分镜图片和资产预览仍使用本地图片 URL。仿真人或已授权真人没有 `Active` 资源时，任务创建接口在积分预扣前返回 `409 TRUSTED_PORTRAIT_REQUIRED`。

相关接口：

- `GET /api/v1/trusted-assets/configuration`
- `GET /api/v1/trusted-assets/portraits?groupType=AIGC|LivenessFace`
- `POST /api/v1/projects/:projectId/assets/:assetId/trusted-portrait/register`
- `POST /api/v1/projects/:projectId/assets/:assetId/trusted-portrait/bind`
- `POST /api/v1/projects/:projectId/assets/:assetId/trusted-portrait/refresh`

## 一键尝鲜资产闭环

剧本页的“一键尝鲜”会先保存用户当前编辑的剧本，再调用文本 Provider 输出严格结构化资产提案。提案只包含 1 到 2 个推动主线的主要人物、1 到 2 套高复用服装和 1 到 2 个核心场景，不创建物品、音频或次要群演。默认画风排除 `photorealistic`，避免第一次体验被真人授权流程阻塞；用户仍可在资产页改成仿真人并按可信人像流程入库。

流程分为两个服务端接口：

- `POST /api/v1/projects/:projectId/quick-start/plan`：分析剧本、跳过同类型同名已有资产，返回资产清单、当前队列、套餐并发、预计积分和 45 到 180 秒/批次的等待区间；分析本身暂不扣平台积分，但限制为每分钟最多 6 次，避免无意产生文本 Provider 成本。
- `POST /api/v1/projects/:projectId/quick-start/execute`：校验剧本 SHA-256 指纹，按服务端价格创建资产、积分流水和图片任务。人物面部候选固定 4 积分，服装和场景各 6 积分，前端不能覆盖价格。

执行使用客户端幂等键 `clientRequestId`，重复确认不会重复建单或扣费。积分、资产和任务在同一个 AppStore 写入批次中完成；余额不足或剧本在分析后变化时，不创建任何资产。并发执行相同方案时，后进入的批次会重新去重。人物任务使用 `generationStage=face` 和 `1:1`，等待用户确认面部后再进入全身/三视图；服装使用平铺展示，场景使用空场景并预留表演空间。

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

图片响应的 `b64_json` 由 API 解码后写入 `ObjectStorage`，前端只读取受登录保护的 `/api/v1/generation/tasks/:taskId/outputs/:view`。参考图最多三张，API 会从本地对象存储读取并以 multipart 文件上传，中转密钥和 Base64 内容不会进入前端状态或项目 JSON。

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

`POST /api/v1/projects/:projectId/script/generate` 默认使用 GPT `5.6`；页面也允许用户为单次中文文本任务选择 GPT `5.4`、`5.5` 或 DeepSeek V3 作为备选。接口接收当前草稿或项目梗概、已确认资产和视觉方向，一次逻辑调用输出适合 15 到 30 秒视频的 4 到 6 个场景、基础动作和对白，目标约 800 到 1600 个中文字符，最大输出为 `2400` tokens。快速生成不会因为格式或篇幅不足而自动进行第二次完整重写；服务端会返回 `warnings`，用户可以继续编辑或主动补齐专业细节。Provider 的自动重试仅用于瞬时连接故障，不属于内容修订。默认文本模型由 `TEXT_MODEL=gpt-5.6` 配置。

`POST /api/v1/projects/:projectId/script/enrich` 是用户主动触发的专业视觉细节补齐接口。它保留快速剧本的场景数量、人物、剧情因果和对白，补充风格、构图、光影、运镜和衔接，最大输出为 `4000` tokens；本次调用也只进行一次逻辑生成，返回 `mode: detailed` 和可能的 `warnings`。生成后前端提供“补齐专业视觉细节”按钮，避免用户每次只想快速起稿时都等待完整制作级剧本。

剧本页的三个结构按钮不是空标签：

- `场景卡`：插入地点、内外景、时间天气、空间层次、关键道具和视觉执行字段。
- `角色卡`：插入身份目标、外观识别点、动作过程和情绪字段。
- `对白段`：插入说话者情绪/动作、台词和对手反应字段。

`POST /api/v1/projects/:projectId/script/review` 是会员专属真实审核接口。服务端强制校验用户套餐，调用文本 Provider 并校验结构化 JSON，返回剧情结构、角色动机、对白表演、风格统一、构图执行、光影设计、运镜节奏七个维度的评分、发现和修改建议，以及优先修改项。审核不写入项目正文，前端保留当前页面结果，用户确认修改后再保存剧本。专业审核是辅助意见，不替代编导最终判断。

`POST /api/v1/projects/:projectId/shots/generate` 不调用文本 Provider，提供两种规则模式。`scene` 保留按剧本非空段落稳定拆分最多 8 个镜头的原功能，每个场次镜头默认独立；`beat` 读取制作级剧本的“动作”字段，按分号拆成单动作节拍，每场最多 4 镜、全片最多 48 镜。动作级镜头使用 5 到 6 秒时长，第一拍建立空间、中段使用中景、收束拍使用特写；每个场次第一拍独立，场内后续动作默认连续。两种模式都不写入通用演示图片；分镜页另有“手动添加”入口。

## Seedance 2.0 视频接入

Seedance 2.0 只用于 `video` 任务，不参与资产图片生成。当前默认 `VIDEO_PROVIDER=stringx`，API 服务直接调用弦序。轮询只把明确的成功或失败状态收敛为本地终态；弦序返回的其他短暂状态继续按生成中处理，避免远端仍在运行时被本地误判失败：

- `POST https://maas.stringx.top/api/v3/contents/generations/tasks`：创建异步视频任务
- `GET https://maas.stringx.top/api/v3/contents/generations/tasks/:taskId`：查询任务状态并取得 `video_url/last_frame_url`
- `POST https://maas.stringx.top/api/v3/contents/generations/tasks/:taskId/cancel`：取消远端任务

视频任务保存 `tier: mini | fast | pro`，默认由前端传 `fast`。`StringXSeedanceProvider` 根据 `STRINGX_SEEDANCE_MINI_MODEL`、`STRINGX_SEEDANCE_FAST_MODEL`、`STRINGX_SEEDANCE_PRO_MODEL` 把 tier 映射为真实 Seedance 模型；没有传 tier 时使用 `STRINGX_SEEDANCE_DEFAULT_TIER`。不要在前端硬编码真实模型名。

官方火山 Provider 仍保留在服务端，可通过 `VIDEO_PROVIDER=volc-ark` 显式启用，只作为回滚通道。弦序任务记录 `providerName=stringx-seedance`，便于审计真实提交路径。

分镜页会根据镜头标题和提示词，从已生成的人物、场景、物品和服装中选择最多三项相关资产。人物优先使用已确认全身基准，选择结果写入图片任务的 `references`，并写入图片和视频任务的 `referenceAssetIds`。旧分镜图没有当前资产标记时会显示“需同步资产”，生成视频时忽略这类旧图，直接使用当前资产。

分镜图片不是 Seedance 视频任务的前置条件。没有分镜图时，单镜头和批量入口都直接发送当前匹配的人物、场景、物品和服装；没有任何可用资产时发送纯镜头提示词。如果用户已经主动创建了分镜图任务，视频任务通过 `dependsOnTaskId` 等待它完成并把结果放在资产参考图之前。该图片任务失败时，依赖视频不会提交 Seedance，并自动退回视频预扣积分。

### 分镜连续性

分镜按场次建立连续链：每个场次首镜为 `independent`，场内后续镜头可为 `continue`。前端的“连续性工作台”只提供两个易懂选项：

- `独立切镜`：不依赖前一个视频，可以按套餐并发生成，适合时间跳转或场景完全变化。
- `承接上镜`：等待上一镜头完成，由服务端取得弦序返回的末帧并放在下一次图片参考首位；同时保留当前镜头选中的人物、场景、物品和服装。

连续模式会把 `continuityMode`、`continuitySourceTaskId`、`dependsOnTaskId` 和 `videoInputMode: "continuity-first-frame"` 写入任务元数据。弦序要求 `first_frame` 与 `last_frame` 成对出现：当前镜头已有分镜图时，平台把上一镜尾帧作为 `first_frame`、当前分镜图作为 `last_frame`；没有当前分镜图时，上一镜尾帧降级为排序第一的普通参考图，不伪造末帧。弦序完成后读取 `last_frame_url` 并写入对象存储；上一镜头没有可用尾帧时，当前任务失败且不提交。

### 服务端质量下限

资产图片和分镜视频的负面提示词不是只在前端展示。Worker 在真正调用 Provider 前通过共享包 `packages/prompting/src/qualityRuleCompiler.ts` 编译，当前版本为 `quality-floor-v1`，并把以下审计字段保存到任务：`qualityRuleVersion`、`qualityPresetIds`、`compiledNegativePrompt`、`userNegativePrompt`。

规则按条件启用：视频通用稳定性、仿真人拍摄设备和背景穿帮、人物五官与手部、场景结构与空场景人物排除、广告产品展示，以及用户自定义负面提示词。动漫/国漫不会误加“禁止动漫”，雾景不会误加“禁止烟雾”，广告允许用户指定的品牌标识。视频 Provider 使用服务端编译后的质量约束；图片 Provider 直接使用 `negativePrompt` 字段。规则用于抬高质量下限，不保证每次生成无瑕，仍需人工验收和必要的重试。

生成队列支持单任务暂停、继续和删除。只有本地仍为 `queued` 的任务可以暂停；暂停任务不参与 Worker 调度。删除等待任务时服务端先切换为 `paused`，再软删除并幂等退回预扣积分。运行中的弦序视频可以调用远端 `cancel`，成功后本地标记 `cancelled`、移出队列并退款。完成或失败任务删除时只写入 `queueHiddenAt`，不会破坏输出 URL。

分镜卡片完整显示镜头提示词、参考资产、图片状态和视频状态，并提供独立的“生成图片”和“生成视频”按钮。两个入口互不依赖；“生成全部视频”也不会暗中创建图片任务。已有且匹配当前资产的分镜图会自动加入视频参考，没有时直接走资产或纯提示词。批量入口和每个镜头均可在生成前选择 `480p`、`720p`、`1080p` 或 `4k`，选中值冻结到任务 `metadata.resolution`。

批量入口提供“并发优先”和“连续优先”。并发优先会把已有连续链均衡规划成最多套餐并发数条链，会员最多 3 条、免费用户 1 条；只把新增链首改为 `independent` 并持久化，链内仍按尾帧依赖顺序生成。连续优先完全保留用户现有衔接。后端 Worker 仍是最终并发控制者：会员同一 tick 最多向 Provider 提交 3 个可运行任务，免费用户最多 1 个。队列页显示实际运行数 / 上限。

API 从对象存储读取受保护的分镜图和资产图并转换为 Base64 Data URL；已激活的可信人物改用 `asset://<asset_id>`。Worker 内部保留 `first_frame/reference_image` 语义，提交 Seedance 时按顺序传入最多 9 个图片引用；没有图片时只发送提示词。任务用 `videoInputMode` 记录 `storyboard-and-assets`、`assets` 或 `text`，便于排查实际生成路径。请求同时携带模型、项目比例、所选清晰度和关闭音频参数。分镜时长统一限制为 4 到 15 秒；建单超时默认 120 秒，建单成功后每 5 秒异步轮询。

承接镜头的上一镜尾帧排在弦序 `content` 图片数组首位，最多仍遵守 9 张图片限制。有当前目标分镜图时提交成对首尾帧；只有上一镜尾帧时使用 `reference_image`，避免触发弦序校验。它不会替代人物/场景的结构化资产，也不会把上一段视频当作当前镜头视频输入。

视频提示词由共享的 `@seqora/prompting` 包编译。`seedance-storyboard-v5` 只保留当前镜头的场景、角色、单个动作节拍和必要视觉字段；相邻镜头只提供动作接点，不再塞入完整上一场、下一场和 1200 字剧本上下文。提示词明确要求同一时间、同一空间、同一动作线，禁止插入特写、钟表、回忆、下一事件、突然切镜、跳时、回切和蒙太奇。前端创建任务时先编译一次，Worker 在真正提交前再按服务端项目数据覆盖编译，旧队列也会自动升级。

成片页默认进入“完整成片”模式，也可以切换到“单镜头”。单镜头只有在 Seedance 任务状态为 `completed` 且存在真实视频 URL 时才渲染 `<video>` 控件；排队、生成和失败状态仅显示分镜参考图与明确状态，不再用静态图模拟视频。

当每个分镜都有已完成的 Seedance 视频后，`POST /api/v1/projects/:projectId/film-preview` 会按分镜顺序创建 `provider: "local-compose"` 的零积分任务。服务端下载对应视频，通过 FFmpeg 统一尺寸、24 fps 和 H.264 编码后拼接成一个 MP4，存入 `ObjectStorage`，再由现有鉴权内容接口提供 Range 播放。项目比例分别输出 `9:16` 的 `720 x 1280`、`16:9` 的 `1280 x 720`、`1:1` 的 `720 x 720`；不同源尺寸使用黑边补齐，不裁切内容。源视频任务 ID 未变化时复用现有预览，任一镜头重新生成后前端会提示重新合成。

该 MP4 是客户检查镜头顺序和节奏的无声视频预览，不再次调用 Seedance，也不扣积分。真实音频、配音、混音、字幕和正式交付导出尚未接入。

第三方任务 ID 只保存在服务端任务 `metadata` 中；前端通过受登录权限保护的 `/api/v1/generation/tasks/:taskId/content` 播放或下载，不接触第三方 API Key。该代理从当前 Seedance Provider 或平台对象存储读取内容并支持浏览器 `Range` 请求。远端提交或生成失败时，任务会保存错误原因并自动退回本次预扣积分，退款账本使用任务 ID 保证幂等。

本地开发在 `apps/api/.env` 配置 `VIDEO_PROVIDER=stringx`、`STRINGX_BASE_URL` 和 `STRINGX_API_KEY`。未配置密钥时开发环境使用本地模拟视频结果；生产环境缺少所选 Provider 密钥会拒绝启动。所有密钥只能通过服务端环境或 Secret Manager 注入，不能写入镜像、前端或 Git。
