# 备份与恢复流程

本文定义单机 Demo/封闭外测环境的完整备份恢复流程。当前商用化前的事实边界是：账号/auth、组织、账单 ledger、项目、资产、分镜和生成任务以 Postgres 为主数据源；`app.json` 只保留本地媒体索引、JSON 历史、兼容状态和迁移备份；媒体对象存储在私有 GCS Bucket 或本地 `uploads` 目录。

## 备份对象

- Postgres：必须备份。包含账号、session、组织 membership、billing accounts、billing ledger、审计日志、项目、项目版本、资产、分镜、生成任务和媒体对象索引。当前表/列仍保留 `tenant*` 兼容命名。
- JSON 历史：必须备份。`/var/lib/seqora/app.json` 是迁移前历史和 Demo 兼容来源，不能作为新业务主源，但恢复排障时需要保留。
- 本地 uploads：当 `STORAGE_DRIVER=local` 或历史数据还引用本地文件时必须备份。脚本会把 `/var/lib/seqora/uploads` 打包为 `json/uploads.tgz`。
- GCS 对象版本：必须至少导出版本清单。数据库和 JSON 只保存对象引用，不包含真实图片、视频和尾帧文件。
- Redis/BullMQ：通常不做持久恢复源。任务事实状态在 Postgres；Redis 只承载触发队列和运行时锁。恢复后由 API/Worker 按 DB 状态继续处理或由管理员重试。

## 前置条件

服务器上需要有 Git、Docker Engine、Docker Compose Plugin。若使用 GCS，还需要安装并认证 `gcloud`，运行 VM 的 service account 至少能读取、列出、创建和删除目标 Bucket 对象。Bucket 必须启用统一访问控制、对象版本控制，并配置生命周期策略；正式商用建议同时启用 soft delete 或等价的托管保护。

生产升级或迁移前执行显式 migration，不依赖 API 启动自动改库：

```bash
docker compose --env-file deploy/demo.env -f compose.demo.yml run --rm api \
  node dist/scripts/dbMigrate.js
```

## 备份

推荐在低峰期做 quiesced backup：暂停 API 和 Worker 写入，保持 Postgres/Redis 运行，完成后脚本会恢复原先运行的 API/Worker。脚本同时读取 `demo.env` 和 `release.env`，并以 `--no-recreate --no-deps` 保持数据服务容器与数据卷不变。

```bash
sudo /opt/seqora/deploy/backup-demo.sh
```

脚本默认输出到 `/opt/seqora-backups/manual/<UTC_TIMESTAMP>`，也可以指定目录：

```bash
sudo SEQORA_BACKUP_DIR=/mnt/backup/seqora /opt/seqora/deploy/backup-demo.sh
```

只做低风险在线演练时可以不暂停 API/Worker，但不能把在线备份当作强一致恢复点：

```bash
sudo /opt/seqora/deploy/backup-demo.sh --online
```

每个备份目录包含：

- `postgres.dump`：`pg_dump -Fc` 生成的 Postgres 自定义格式备份。
- `schema_migrations.csv`：恢复点对应的 migration 记录。
- `table_counts.csv`：Postgres 用户表的估算行数，用于快速核对。
- `json/app.json`：JSON 历史状态。
- `json/uploads.tgz`：本地上传目录快照，存在时才生成。
- `gcs-bucket.json`：Bucket 元数据，含版本控制等非密钥配置。
- `gcs-object-versions.txt`：live 与 noncurrent 对象 generation 清单，包含可用于恢复的 version-specific URL。
- `gcs-live-objects.json`：当前 live 对象元数据，便于按对象路径核对。
- `demo-env.sha256`：`deploy/demo.env` 的哈希，不记录密钥明文。
- `manifest.json`：备份时间、Git commit、migration head、storage driver、bucket 名等非密钥元数据。
- `warnings.log`：脚本跳过 GCS 或部分元数据时才生成。

完成后至少做三项检查：

```bash
test -s /opt/seqora-backups/manual/<UTC_TIMESTAMP>/postgres.dump
test -s /opt/seqora-backups/manual/<UTC_TIMESTAMP>/json/app.json
grep -q '"containsSecrets": false' /opt/seqora-backups/manual/<UTC_TIMESTAMP>/manifest.json
```

若 `STORAGE_DRIVER=gcs`，还要确认 `gcs-object-versions.txt` 存在且非空。GCS 清单只记录对象版本，不会把媒体内容复制到本地；需要异地不可变备份时，再把对象同步到单独的备份 Bucket。

## 恢复

恢复会覆盖当前数据库和 JSON 历史。必须先确认要恢复的代码版本：优先切到备份 `manifest.json` 中记录的 `gitCommit`，或确认当前代码可以把旧备份向前迁移。

```bash
cd /opt/seqora
git fetch --all --tags
git checkout <MANIFEST_GIT_COMMIT_OR_APPROVED_RELEASE>
docker compose --env-file deploy/demo.env -f compose.demo.yml build api web
sudo /opt/seqora/deploy/restore-demo.sh --yes /opt/seqora-backups/manual/<UTC_TIMESTAMP>
```

恢复脚本会执行：

1. 启动并等待 Postgres/Redis。
2. 停止 API 和 Worker，阻断写入。
3. 默认创建一份 pre-restore 安全备份到 `/opt/seqora-backups/pre-restore`。
4. 清空 `public` schema，再用 `pg_restore --no-owner` 恢复 `postgres.dump`，避免当前库遗留备份之外的旧对象。
5. 复制 `json/app.json`，并在存在 `uploads.tgz` 时恢复本地上传目录。
6. 默认运行当前镜像的 `node dist/scripts/dbMigrate.js`，把旧备份迁移到当前 schema。
7. 启动 API、Worker、Web，并检查 `/api/v1/health`。

若只想恢复到历史代码和历史 schema，不向前执行 migration：

```bash
sudo SEQORA_RESTORE_RUN_MIGRATIONS=false \
  /opt/seqora/deploy/restore-demo.sh --yes /opt/seqora-backups/manual/<UTC_TIMESTAMP>
```

## GCS 对象版本恢复

Postgres/JSON 恢复不会自动覆盖 GCS 对象。这样做是为了避免把仍然有效的新媒体误覆盖。需要恢复具体图片、视频或尾帧时，先从 `gcs-object-versions.txt` 或 Google Cloud Console 查出对象 path 和 generation，再执行：

```bash
sudo /opt/seqora/deploy/restore-gcs-version.sh --yes \
  gs://seqora-media/projects/<projectId>/shots/<shotId>/clip.mp4 \
  <GENERATION>
```

命令等价于把 `gs://bucket/object#GENERATION` 复制回 `gs://bucket/object`，新的 live version 会获得新的 generation。若 Bucket 启用了对象版本控制，被替换掉的 live version 会成为新的 noncurrent version。

批量恢复 GCS 前必须先做 dry-run 清单评审：列出要恢复的对象、generation、所属组织/project、恢复原因和操作者。不要用递归覆盖命令批量回滚整个 Bucket，除非已经在隔离环境完整演练并获得业务确认。

## 演练与保留策略

- 外测阶段：每周至少一次全量备份，每月至少一次恢复演练；每次 API migration、支付/账单改动、项目域结构改动前必须手动备份。
- 商用前：增加自动定时备份、异地备份、备份完整性校验、恢复耗时记录、备份加密、访问审计和告警。
- 保留建议：每日备份保留 14 天，每周备份保留 8 周，重大版本上线前备份永久或按合同保留。
- 权限边界：备份目录、Postgres dump、JSON、GCS manifest 都可能包含用户数据和媒体路径，只允许 owner/super_admin 或运维 service account 访问。

## 恢复验收

恢复完成后按顺序验证：

1. `https://<APP_ADDRESS>/api/v1/health` 返回正常。
2. owner、super_admin、admin、member 至少各登录一次。
3. `/api/v1/billing/summary` 能读到 Postgres ledger 汇总。
4. 项目列表、剧本、资产、分镜可以读取，跨组织数据不可见。
5. 一个历史媒体对象能正常通过 API 读取或签名跳转。
6. Redis/BullMQ Worker 能接收新任务；历史运行中任务按业务策略重试、取消或标记失败。
7. 管理员端审计日志能看到恢复后的关键账号和账单记录。

恢复验收通过后，把备份目录、恢复操作者、恢复原因、代码 commit、migration head、GCS generation 变更记录到运维日志。
