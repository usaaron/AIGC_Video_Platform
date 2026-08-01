# CI/CD 与模块化发布

当前推荐链路是：GitHub `main` -> CI 检查 -> Artifact Registry 镜像 -> GCE 单模块更新。Web 和 API 是两个独立镜像；只改前端时不重启 API，只改后端时不重启 Web，共享契约、锁文件或 Compose 变化会同时发布两端。

## 日常流程

1. 功能分支提交 Pull Request。
2. `.github/workflows/ci.yml` 执行格式、Lint、测试和构建；其中 `database` job 会起 Postgres 和 Redis、执行 migration，并运行 auth/account/billing/queue 集成测试；`.github/workflows/containers.yml` 验证两个容器可以构建。
3. Review 通过后合并到 `main`。
4. CI 根据本次完整 Push 的文件变化生成发布清单。
5. `.github/workflows/deploy.yml` 使用 Workload Identity Federation 获取短期 Google 凭据，推送不可变 Commit SHA 镜像，并通过 IAP SSH 更新 GCE。
6. `deploy/update-release.sh` 备份数据和旧镜像清单、更新目标模块、检查 `https://zjh.ai/api/v1/health`；失败时自动恢复旧镜像。

不把 Google 服务账号 JSON、模型 Key、密码或 `deploy/demo.env` 保存到 GitHub 仓库。GitHub 到 Google Cloud 只使用短期身份令牌。

## 一次性 Google Cloud 配置

以下命令由 Google Cloud 项目管理员在 Cloud Shell 执行。资源名可以调整，但调整后 GitHub Variables 必须一致。

```bash
export PROJECT_ID='project-935680ce-9aaf-496a-bb7'
export REGION='asia-east2'
export REPOSITORY='seqora'
export INSTANCE='instance-20260719-184241'
export ZONE='asia-east2-c'
export GITHUB_REPOSITORY='usaaron/AIGC_Video_Platform'
export POOL='github-actions'
export PROVIDER='github'
export DEPLOY_SA='seqora-github-deploy'

gcloud config set project "$PROJECT_ID"
gcloud services enable \
  artifactregistry.googleapis.com \
  compute.googleapis.com \
  iamcredentials.googleapis.com \
  iap.googleapis.com \
  sts.googleapis.com

gcloud artifacts repositories create "$REPOSITORY" \
  --repository-format=docker \
  --location="$REGION" \
  --description='Seqora production images'

gcloud iam service-accounts create "$DEPLOY_SA" \
  --display-name='Seqora GitHub deploy'
export DEPLOY_SA_EMAIL="${DEPLOY_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" \
  --location="$REGION" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role='roles/artifactregistry.writer'
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role='roles/compute.viewer'
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role='roles/compute.osAdminLogin'
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role='roles/iap.tunnelResourceAccessor'

gcloud iam workload-identity-pools create "$POOL" \
  --location='global' \
  --display-name='GitHub Actions'
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --location='global' \
  --workload-identity-pool="$POOL" \
  --display-name='AIGC Video Platform' \
  --issuer-uri='https://token.actions.githubusercontent.com' \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
  --attribute-condition="assertion.repository=='${GITHUB_REPOSITORY}' && assertion.ref=='refs/heads/main'"

export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" \
  --role='roles/iam.workloadIdentityUser' \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPOSITORY}"
```

让运行中的 VM 能拉取私有镜像：

```bash
export VM_SA_EMAIL="$(gcloud compute instances describe "$INSTANCE" \
  --zone="$ZONE" --format='value(serviceAccounts[0].email)')"
gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" \
  --location="$REGION" \
  --member="serviceAccount:${VM_SA_EMAIL}" \
  --role='roles/artifactregistry.reader'

gcloud compute project-info add-metadata --metadata='enable-oslogin=TRUE'
gcloud compute instances describe "$INSTANCE" --zone="$ZONE" \
  --format='flattened(serviceAccounts[].scopes[])'
```

最后一条命令必须包含 `https://www.googleapis.com/auth/cloud-platform`。如果没有，需要停机后使用 `gcloud compute instances set-service-account ... --scopes=cloud-platform` 调整并重新启动。IAP SSH 还要求防火墙允许来源 `35.235.240.0/20` 访问 VM 的 TCP 22。

获取下面要填入 GitHub Secret 的两个值：

```bash
gcloud iam workload-identity-pools providers describe "$PROVIDER" \
  --location='global' \
  --workload-identity-pool="$POOL" \
  --format='value(name)'
echo "$DEPLOY_SA_EMAIL"
```

## 一次性 GitHub 配置

在 GitHub 仓库 `Settings -> Environments` 创建 `production` 环境。建议启用 Required reviewers，并把 Deployment branches 限制为 `main`。

在 `production` 环境添加 Secrets：

| 名称                             | 值                                                |
| -------------------------------- | ------------------------------------------------- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | 上一步输出的完整 Provider Name                    |
| `GCP_SERVICE_ACCOUNT`            | `seqora-github-deploy@...iam.gserviceaccount.com` |

添加 Variables：

| 名称                           | 当前值                           |
| ------------------------------ | -------------------------------- |
| `GCP_PROJECT_ID`               | `project-935680ce-9aaf-496a-bb7` |
| `GCP_REGION`                   | `asia-east2`                     |
| `ARTIFACT_REGISTRY_REPOSITORY` | `seqora`                         |
| `GCE_INSTANCE`                 | `instance-20260719-184241`       |
| `GCE_ZONE`                     | `asia-east2-c`                   |

在 `Settings -> Branches` 保护 `main`：要求 `CI / quality`、`CI / database` 通过、至少一位 Review、禁止强推。三人协作时采用短功能分支和小 PR，避免多人直接覆盖 `main`。

## 手动发布与回滚

正常情况下合并 `main` 后自动发布。需要重发时进入 `Actions -> Deploy Production -> Run workflow`：

- `api`：只发布 API。
- `web`：只发布 Web。
- `all`：发布两端。
- `auto`：手动运行时按安全策略等同 `all`；自动流水线会读取 CI 的精确发布清单。

每次发布使用 Commit SHA 标签，旧镜像不会被覆盖。服务器会在 `/opt/seqora-backups/releases` 保存发布前的 `app.json` 和镜像清单，并在健康检查失败时自动回滚。发布前和破坏性 migration 前还必须运行 [备份与恢复流程](BACKUP_RESTORE.md) 的全量备份，保留 Postgres dump、JSON 历史与 GCS generation 清单。需要人工回退到指定镜像时：

```bash
sudo /opt/seqora/deploy/update-release.sh api \
  asia-east2-docker.pkg.dev/PROJECT/seqora/seqora-api:COMMIT_SHA
sudo /opt/seqora/deploy/update-release.sh web \
  asia-east2-docker.pkg.dev/PROJECT/seqora/seqora-web:COMMIT_SHA
```

## 当前边界

- CI/CD 文件已经就绪，但在 Artifact Registry、Workload Identity Federation、GitHub Environment 和 IAM 未完成前，自动部署不会成功。
- 当前单实例更新会短暂重建目标容器，不是零停机。Web 通常为数秒，API 更新期间新请求可能短暂失败。
- API 已使用 Postgres 承载账号/auth/session/组织 membership、账单 ledger、项目、资产、分镜、生成任务、AI Job 和小说域数据；任务触发通过 Postgres Outbox 投递 Redis/BullMQ，由独立 Worker 进程消费。更新 API 前会备份 Postgres 与 JSON 兼容数据；客户规模扩大前应补齐队列监控、重复投递验证、Worker 横向扩缩容演练和运行中任务恢复演练。
- 数据结构发生破坏性变化时必须先写迁移脚本，不能只依赖镜像回滚。
