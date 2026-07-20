# 资产生成与 Provider 接入

## 资产分类

资产使用五个稳定类型：`character`、`scene`、`prop`、`costume`、`audio`。每个资产同时保存结构化 `attributes` 和生成时使用的中文 `prompt`，便于更换模型时重新编译或直接复用提示词。

图片资产支持 `generate` 和 `import` 两种来源，单项资产最多保存三张参考图。常规图片继承项目 `aspectRatio`；人物面部大头照固定为 `1:1`，三视图设定表固定为 `16:9`。

道具资产只为剧情关键、反复出现或需要保持外观一致的物件创建。结构化属性 `usage` 只允许 `key` 和 `recurring` 两类；一次性背景物、临时摆件和只在单个镜头出现的普通物件，直接写入对应镜头提示词，不进入资产库。

## 人物定稿流程

人物采用有顺序的三阶段流程：

1. **面部定稿**：生成或导入大头照，用户明确设为面部基准后才解锁全身阶段。
2. **全身定稿**：生成任务自动携带已确认面部；可选择腿部比例优化，用户确认全身基准后才解锁三视图。
3. **三视图**：任务自动携带面部和全身两个基准，生成正面、侧面、背面三张独立源图。

三张源图始终保存在任务 `outputs` 和人物资产 `attributes.turnaroundReferences` 中，便于单独重试和后续传给 Seedance。前端默认把它们排成一张 `2400 x 1350` 的三栏 PNG 设定表供预览和下载，也可以切换查看三张源图。旧人物资产在读取时会自动补齐阶段状态和基准图字段。

## 媒体上传

```http
POST /api/v1/projects/:projectId/media
Content-Type: multipart/form-data
```

表单字段固定为 `file`。图片支持 JPG、PNG、WebP，音频支持 MP3、WAV、OGG 和 MP4 音频，默认单文件上限 10MB。接口返回媒体 ID 和受登录权限保护的 `/api/v1/media/:mediaId` URL。

对象存储由 `ObjectStorage` 隔离：

- `STORAGE_DRIVER=local`：仅限零配置开发，文件写入 `UPLOAD_DIR`，生产环境禁止使用
- `STORAGE_DRIVER=gcs`：Demo 环境使用 Google Cloud Storage，通过 ADC 或 `GOOGLE_APPLICATION_CREDENTIALS` 认证
- `STORAGE_DRIVER=oss`：阿里云 OSS，通过 `OSS_REGION`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID` 和 `OSS_ACCESS_KEY_SECRET` 认证；如果使用自定义域名或内网 endpoint，可配置 `OSS_ENDPOINT`

媒体路由和业务服务只依赖 `ObjectStorage`，不会直接调用云厂商 SDK。部署环境只需要切换环境变量，不需要修改前端上传接口。

## Img2 接入

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
    "outputLayout": "sheet"
  }
}
```

`generationStage` 的取值为 `face`、`body`、`turnaround`。中转 Provider 会从 `attributes.faceReference`、`attributes.bodyReference` 和分阶段 `references` 中提取面部参考、全身参考；三视图返回三个带 `front`、`side`、`back` 视角标识的独立输出，不允许在 Provider 内提前拼成一张图。

第三方中转适配器实现 `apps/api/src/core/generation/imageProvider.ts` 中的 `ImageGenerationProvider`。Provider 负责把受保护的参考图转换为中转服务可读取的上传文件或签名 URL，并映射创建任务、查询状态和输出结果。API Key 只能存在于 API/Worker 环境变量中。

当前 API 已提供 `AideosImageProvider`：

- 未配置 `IMG2_API_KEY` 时，图片任务继续走本地 mock。
- 已配置 `IMG2_API_KEY` 时，`provider: "img2"` 的图片任务会提交到 Aideos 图片接口。
- 如果 `IMG2_API_KEY` 留空但 `SEEDANCE_API_KEY` 已配置，则默认复用同一个 Aideos Key。
- 面部参考通过 `face_reference_url` 和 `reference_images[].role = "face"` 传递。
- 全身参考通过 `body_reference_url` 和 `reference_images[].role = "body"` 传递。
- `turnaround` 或 `generationStage: "turnaround"` 会请求 `front`、`side`、`back` 三张输出。
- 受登录保护的 `/api/v1/media/:id` 参考图不会直接传给第三方；当前只透传第三方可访问的 `http(s)` 参考图 URL。

## Seedance 2.0 视频接入

Seedance 2.0 只用于 `video` 任务，不参与资产图片生成。API 服务通过 Aideos 中转调用以下接口：

- `POST /v1/video/generations`：创建异步视频任务
- `GET /v1/videos/:taskId`：每 5 秒轮询一次任务状态
- `GET /v1/videos/:taskId/content`：读取已完成视频

分镜生成会提交标准模型、分镜提示词、时长、项目画面比例、`720p` 和可公开读取的参考图。第三方任务 ID 只保存在服务端任务 `metadata` 中；前端通过受登录权限保护的 `/api/v1/generation/tasks/:taskId/content` 播放或下载，不接触第三方 API Key。

本地开发在 `apps/api/.env` 配置 `SEEDANCE_API_KEY`。未配置密钥时，开发环境继续使用本地模拟视频结果；部署环境应通过密钥管理服务注入，不能写入镜像或 Git。
