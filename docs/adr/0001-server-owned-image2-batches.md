# Server-Owned Image2 Batches

Status: accepted

生图大师使用专用 `POST /api/v1/image2/batches` 入口，由服务端持有 Provider URL、API Key、模型选择、积分计算和任务创建。浏览器只提交提示词、负面提示词、画幅/尺寸、生成质量、张数、引用图和辅助能力开关。

This avoids two unsafe alternatives: storing image Provider credentials in the browser, or using the generic generation task endpoint where client-supplied estimated credits could be tampered with. The trade-off is a narrower dedicated API, but that API matches the product boundary and keeps billing, provider policy and retry semantics server-owned.
