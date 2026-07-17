# 资产生成与 Provider 接入

## 资产分类

资产使用五个稳定类型：`character`、`scene`、`prop`、`costume`、`audio`。每个资产同时保存结构化 `attributes` 和生成时使用的中文 `prompt`，便于更换模型时重新编译或直接复用提示词。

图片资产支持 `generate` 和 `import` 两种来源。单项资产最多保存三张参考图；三视图保存为正面、侧面、背面三个独立输出，而不是一张拼图。常规图片和每张三视图都继承项目 `aspectRatio`。

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
    "aspectRatio": "9:16",
    "sourceMode": "import",
    "references": [{ "id": "media-id", "url": "/api/v1/media/media-id", "name": "face.png" }],
    "attributes": {},
    "turnaround": true
  }
}
```

第三方中转适配器实现 `apps/api/src/core/generation/imageProvider.ts` 中的 `ImageGenerationProvider`。Provider 负责把受保护的参考图转换为中转服务可读取的上传文件或签名 URL，并映射创建任务、查询状态和输出结果。API Key 只能存在于 API/Worker 环境变量中。

Seedance 2.0 只用于 `video` 任务，不参与资产图片生成。
