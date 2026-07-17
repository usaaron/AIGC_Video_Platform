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

第三方中转适配器实现 `apps/api/src/core/generation/imageProvider.ts` 中的 `ImageGenerationProvider`。Provider 负责把受保护的参考图转换为中转服务可读取的上传文件或签名 URL，并映射创建任务、查询状态和输出结果。API Key 只能存在于 API/Worker 环境变量中。

Seedance 2.0 只用于 `video` 任务，不参与资产图片生成。
