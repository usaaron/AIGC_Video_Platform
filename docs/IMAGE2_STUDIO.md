# 生图大师

本文记录 `image-studio` 当前正式产品形态。对用户展示的功能名是“生图大师”；代码和接口中仍保留 `image2`、`img2`、`TokenAdventImageProvider` 等内部兼容名。

## 当前边界

- 前端只负责提示词、负面提示词、画幅/尺寸、生成质量、张数、引用图和辅助能力开关。
- 前端不展示、不保存、不传输 Provider API Key 或真实 Provider URL。
- 批次提交走 `POST /api/v1/image2/batches`，不要让页面直接调用通用 `/generation/tasks` 来创建正式生图任务。
- 服务端校验登录态、项目权限、Provider 配置、引用图归属和积分余额。
- 服务端按价格规则扣费；当前生图大师初始价格是 `6` 积分/张。
- 浏览器中的预计消耗只用于展示和确认弹窗，服务端不信任浏览器传入的估算积分。

## 生成参数

- 对外名称：`生图大师`。
- 内部任务：`kind=image`，`provider=img2`。
- 内部模型：由服务端 `SEQORA_IMAGE2_MODEL` 配置，兼容旧 `IMG2_MODEL`。
- Provider 地址和 Key：优先使用 `SEQORA_IMAGE2_BASE_URL`、`SEQORA_IMAGE2_API_KEY`，兼容旧 `TOKENADVENT_*`。
- 辅助能力模型：`SEQORA_IMAGE2_ASSIST_MODEL`，默认 `gpt-5.4`。
- 默认画幅/尺寸：`auto`。
- 生成质量：`low | medium | high`。页面文案要避免把它和“图片尺寸”混为一谈。
- 张数：当前上限 `20` 张；每次提交前必须展示本次张数、预计消耗和当前余额。

## 引用图

- 最多 5 张输入图：主体图最多 1 张，非主体引用图最多 4 张。
- 角色：主体、服装、帽子/配饰、风格、构图、色调。
- 每张图有稳定图号，页面可以把“图 1 / 图 2”插入提示词。
- 前端应提示不存在的图号引用，以及“主体图被当成服装/风格参考使用”这类潜在冲突。
- 上传前端预处理：最长边 2048，JPEG 质量 0.88；上传后只保存 `mediaId/url/role/referenceNumber`。
- 生成时传引用图身份，Provider 请求由服务端读取媒体对象后组装。

## 高级辅助

- “提示词优化”和“引用图视觉解析”都是服务端托管能力。
- 这两个能力通过服务端调用 `/v1/chat/completions`，浏览器不能拿到 chat Key。
- 引用图视觉解析会把可用的引用图描述写入生成提示词和生成快照。
- 严格重做必须复用原生成快照，不再次优化提示词。

## Provider 对齐

- 无引用图调用 `/v1/images/generations`。
- 有引用图调用 `/v1/images/edits`。
- 请求参数对齐：`moderation: "low"`、`stream: true`、`partial_images: 2`。
- 服务端可解析 JSON、URL、Base64、Data URL、图片二进制和 SSE partial/final image 响应。
- 最终写入媒体和任务输出的是服务端解析后的图片内容，不是前端缓存结果。

## 结果与复用

- 结果画廊展示可理解的“第几次生成”，不要把后端 `batchId` 直接暴露给用户当主标签。
- 用户需要能在预览弹窗查看和复制完整提示词。
- 结果支持单图下载、整组下载、删除、放大/缩小、拖拽预览、重做、编辑和设为引用图。
- 浏览器缓存最近 60 张结果；优先 IndexedDB，失败时用 localStorage fallback。
- 失败图片中间可点击重试；重试成功提交后隐藏原失败图，避免占位干扰。
- 编辑当前图片时恢复最终提示词，并按当前规则清空其他引用图。

## 必须保持的不变量

- 页面里不能出现 API Key、API 地址、本机保存 Key。
- localStorage 和 IndexedDB 不能保存 Provider Key。
- 扣费、退款和最终任务价格以服务端为准。
- 未登录、积分不足、Provider 未配置都要有明确错误。
- 生图大师视觉必须贴合序幕TV，不回退到 ImageForge 蓝白 SaaS 风格。
