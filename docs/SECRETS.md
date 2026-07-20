# 密钥管理

## 原则

所有密钥只允许通过环境变量、本地未提交的 `.env` 文件或部署平台 Secret Manager 注入。密钥不能写入 Git、镜像、前端 `VITE_*` 变量、日志、测试快照或示例文档。

本地开发：

- 使用 `apps/api/.env` 保存真实密钥。
- `apps/api/.env.example` 只保留变量名、空值和占位说明。
- `.env`、`.env.*`、证书和私钥文件已由 `.gitignore` 排除。

部署环境：

- 使用云平台 Secret Manager、Kubernetes Secret、GitHub Actions Secrets 或 CI/CD 平台等价能力注入环境变量。
- 容器镜像和构建产物不包含 `.env` 文件。
- 服务端密钥只注入 `apps/api` 运行环境，不能注入 `apps/web`。

## 当前密钥清单

| 变量                             | 用途                                                  | 注入位置                      |
| -------------------------------- | ----------------------------------------------------- | ----------------------------- |
| `AUTH_SECRET`                    | 签名 HttpOnly 会话 Cookie                             | API 环境变量或 Secret Manager |
| `SEEDANCE_API_KEY`               | Aideos Seedance 视频生成                              | API 环境变量或 Secret Manager |
| `IMG2_API_KEY`                   | Aideos Img2 图片生成；为空时可复用 `SEEDANCE_API_KEY` | API 环境变量或 Secret Manager |
| `OSS_ACCESS_KEY_ID`              | 阿里云 OSS Access Key ID                              | API 环境变量或 Secret Manager |
| `OSS_ACCESS_KEY_SECRET`          | 阿里云 OSS Access Key Secret                          | API 环境变量或 Secret Manager |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCS 服务账号文件路径；文件本身不提交 Git              | API 运行环境                  |
| `DATABASE_URL`                   | PostgreSQL 连接串，迁移后启用                         | API 环境变量或 Secret Manager |

## 运行时约束

- `NODE_ENV=production` 时禁止 `AUTH_MODE=demo`。
- `NODE_ENV=production` 时禁止默认或占位 `AUTH_SECRET`。
- `NODE_ENV=production` 时禁止 `STORAGE_DRIVER=local`。
- `STORAGE_DRIVER=oss` 时必须提供 OSS bucket、Access Key 和 region 或 endpoint。
- 健康检查只暴露 Provider 是否配置和存储驱动名称，不返回任何密钥值。

## 轮换建议

- Aideos、OSS、GCS 和数据库密钥按部署环境分别创建，不共用个人账号长期密钥。
- 生产密钥至少按季度轮换；人员离开项目后立即轮换。
- 轮换时先在 Secret Manager 更新新值，再滚动重启 API，确认任务生成和媒体上传正常后停用旧密钥。
