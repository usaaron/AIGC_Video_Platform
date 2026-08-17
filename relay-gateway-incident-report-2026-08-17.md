# DeepSeek 中转网关 502 故障报告

## 1. 故障概述

调用 `deepseek-v4-flash` 的 OpenAI Compatible Chat Completions 接口时，主、备用中转站持续返回 HTTP 502。流式生产请求和非流式最小探测请求均失败，且没有返回任何模型正文或推理内容。

API Key、业务提示词和项目数据均已脱敏。

## 2. 故障时间

- 北京时间：2026-08-17 09:41:27–09:41:28
- UTC：2026-08-17 01:41:27–01:41:28

## 3. 调用配置

```text
接口协议：OpenAI Compatible Chat Completions
模型名称：deepseek-v4-flash
接口路径：POST /v1/chat/completions
认证方式：Authorization: Bearer <API_KEY 已脱敏>
```

生产请求配置：

```text
stream=true
thinking={"type":"enabled"}
reasoning_effort="high"
max_tokens=16000
```

## 4. 主中转站故障信息

```text
Base URL：https://rehdasu.cn/v1
请求地址：https://rehdasu.cn/v1/chat/completions
HTTP 状态：502
响应类型：text/plain; charset=UTF-8
响应内容：error code: 502
Server：cloudflare
CF-Ray：a2c4f9f5df4e2b22-SEA
Remote IP：172.67.74.111
```

网络耗时：

```text
DNS：0.001842 秒
TCP 连接：0.436246 秒
TLS：0.971189 秒
首字节：3.980821 秒
总耗时：3.982505 秒
```

生产流式请求结果：

```text
耗时：13.15 秒
HTTP 状态：502
返回正文字符：0
返回推理字符：0
错误：provider gateway returned an HTML error page
```

## 5. 备用中转站故障信息

```text
Base URL：https://tokenadvent.com/v1
请求地址：https://tokenadvent.com/v1/chat/completions
HTTP 状态：502
响应类型：application/json; charset=utf-8
Server：nginx/1.18.0 (Ubuntu)
X-Request-ID：527b9fc0-e2b5-472e-b258-f9b9cbc57742
Remote IP：8.209.241.20
```

响应内容：

```json
{
  "error": {
    "message": "Upstream access forbidden, please contact administrator",
    "type": "upstream_error"
  }
}
```

网络耗时：

```text
DNS：0.014299 秒
TCP 连接：0.091383 秒
TLS：0.173920 秒
首字节：3.121270 秒
总耗时：3.123131 秒
```

生产流式请求连续三次结果：

```text
第 1 次：6.37 秒后返回 502，content_chars=0
第 2 次：8.01 秒后返回 502，content_chars=0
第 3 次：7.02 秒后返回 502，content_chars=0
```

## 6. 最小复现请求

使用短提示词、非流式请求和较小输出预算测试，仍返回相同的 502。因此可以排除提示词过长、流式连接和 16K 输出预算造成的问题。

```http
POST /v1/chat/completions
Authorization: Bearer <API_KEY 已脱敏>
Content-Type: application/json
```

```json
{
  "model": "deepseek-v4-flash",
  "messages": [
    {
      "role": "user",
      "content": "Reply with exactly OK."
    }
  ],
  "stream": false,
  "max_tokens": 64
}
```

主中转站最小请求结果：

```text
HTTP/2 502
content-type: text/plain; charset=UTF-8
server: cloudflare
cf-ray: a2c4f9f5df4e2b22-SEA

error code: 502
```

备用中转站最小请求结果：

```text
HTTP/2 502
content-type: application/json; charset=utf-8
server: nginx/1.18.0 (Ubuntu)
x-request-id: 527b9fc0-e2b5-472e-b258-f9b9cbc57742

{"error":{"message":"Upstream access forbidden, please contact administrator","type":"upstream_error"}}
```

## 7. 客户端重试与保存情况

- 首次请求依次尝试主网关和备用网关，总耗时约 19.53 秒。
- 后续两次自动恢复期间，主网关因短期熔断被跳过，备用网关分别在约 8.01 秒和 7.02 秒后返回 502。
- 三次请求均为 `content_chars=0`、`reasoning_chars=0`，上游模型没有开始返回内容。
- 本地生成任务状态和项目工作区保存成功。
- 客户端网关切换、自动重试、熔断和失败保存流程运行正常。

## 8. 初步判断

DNS、TCP 和 TLS 均成功，故障发生在中转站接收请求之后、上游模型开始输出之前，不属于本地网络连接、JSON 校验、提示词长度或剧本生成逻辑问题。

备用站明确返回 `Upstream access forbidden`，较可能的原因包括：

- 当前中转站账号或 API Key 没有 `deepseek-v4-flash` 调用权限。
- 中转站配置的上游 DeepSeek 账号、密钥、额度或 IP 被限制。
- `deepseek-v4-flash` 模型映射失效或模型别名已变更。
- 上游模型线路被暂停、封禁或临时下线。
- 中转站到上游供应商的网络或代理线路异常。

## 9. 请中转站协助核查

1. 确认当前 API Key 是否拥有 `deepseek-v4-flash` 的调用权限。
2. 确认 `deepseek-v4-flash` 是否仍是有效模型标识，并提供实际可用的模型名称。
3. 检查中转站所使用的上游账号、密钥、余额、额度、区域和 IP 限制。
4. 根据备用站 `X-Request-ID: 527b9fc0-e2b5-472e-b258-f9b9cbc57742` 查询服务端日志。
5. 根据主站 `CF-Ray: a2c4f9f5df4e2b22-SEA` 查询 Cloudflare 和源站日志。
6. 确认 `/v1/chat/completions` 是否支持流式请求、`thinking` 和 `reasoning_effort` 参数。
7. 提供预计恢复时间，或提供一个能够实际返回模型内容的备用线路。

## 10. 期望结果

使用上述最小复现请求时，应返回 HTTP 200，并在 `choices[0].message.content` 或对应推理字段中返回有效内容；生产流式请求应能够持续返回数据片段，而不是在模型输出开始前返回 502。
