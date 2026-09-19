# Script Master 独立生产部署

2026-09-20 本地新版候选尚未发布；新前后端需要配套更新，详见 [新版 final2 融合记录](UPSTREAM_REFRESH_2026-09-20.md)。本文中的命令不是已执行的发布记录。

宿主是 SEQORA，生产路径为 `https://xumutv.com/script-master`。此目录包含
`final2` 的完整独立前后端部署入口，不应仅发布宿主的功能栈按钮。

## 服务边界

- Compose 项目名为 `script-master`，与宿主 `seqora-demo` 分开维护。
- `script-master-web`：Next.js 生产 standalone，构建时固定 `/script-master`。
- `script-master-api`：FastAPI 单进程，保留原来的生成、版本、分镜、导出 API。
- `script-master-db`：独立 PostgreSQL 16，持久卷 `script-master_script_master_postgres`。
- 后端可选评估报告放在 `script-master_script_master_reports` 卷中，按账号目录隔离。
- 只将前端连接到宿主的 `seqora-demo_default` 网络。API、数据库不映射公网端口。
- 宿主 Caddy 对整个路径执行主站登录校验；后端还校验签名票据和读写权限。
- 账号数据按组织和用户的组合分配私有 PostgreSQL schema。每个事务设置自己的
  `search_path`，不回退公共 schema；浏览器缓存也按相同身份分开。
- `public` 只保存预置参考资料。迁移脚本不把历史用户项目、剧本或上传资产分发给账号。
- 长时间工作台通过主站会话续领短期票据；切换账号或失去会话时停止旧页面同步。

## 配置与首次安装

源代码目录使用 `/opt/script-master/releases/<commit>`；密钥独立保存在
`/opt/script-master/shared/`，目录权限 700，文件权限 600。Compose 2.30+ 支持 raw env。

`backend.env` 包含已经展开变量引用的 `LLM_*`、`SCRIPT_*` 模型配置，以及：

```dotenv
DATABASE_URL=postgresql+psycopg://script_master:<独立应用密码>@script-master-db:5432/script_master
HOST_INTEGRATION_REQUIRED=true
SCRIPT_MASTER_ACCOUNT_ISOLATION=true
HOST_INTEGRATION_SECRET=<与宿主相同的随机共享密钥>
FRONTEND_ORIGINS=https://xumutv.com
NO_PROXY=localhost,127.0.0.1,script-master-api,script-master-db
```

`postgres.env` 使用另一个数据库管理员密码，仅给数据库容器：

```dotenv
POSTGRES_USER=script_master_admin
POSTGRES_PASSWORD=<数据库管理员密码>
POSTGRES_DB=script_master
```

不要复制开发机的 SQLite 路径或数据，也不要把 `.env.local` 交给 Next.js。
共享密钥、模型密钥、数据库密码不得提交或打入镜像。raw env 中不能保留 `${变量}`，
导入开发配置时必须先安全展开引用，不执行配置文件里的命令。

`release.env` 记录经过测试的不可变镜像标签：

```dotenv
SCRIPT_MASTER_API_IMAGE=script-master-api:<commit>
SCRIPT_MASTER_WEB_IMAGE=script-master-web:<commit>
```

在源码目录运行：

```sh
docker compose --env-file release.env -f compose.production.yml config --quiet
docker compose --env-file release.env -f compose.production.yml build
docker compose --env-file release.env -f compose.production.yml up -d --no-build script-master-db
python3 deploy/initialize-database.py
docker compose --env-file release.env -f compose.production.yml run --rm --no-deps script-master-api python scripts/prepare_production.py
docker compose --env-file release.env -f compose.production.yml up -d --no-build script-master-api script-master-web
```

初始化脚本只建立非超级用户应用角色。`prepare_production.py` 使用 Alembic 升级公共
模板及已有账号 schema，校验并写入两个市场的静态标签、策略和提示词；不调用模型。
新账号首次打开时按同一套 migration 创建自己的 schema。

## 接通宿主

先备份宿主的 `deploy/demo.env`、`deploy/release.env`、Caddyfile，以及双方数据库。
独立服务 readiness 通过之后，给宿主 `deploy/demo.env` 配置：

```dotenv
SCRIPT_MASTER_URL=https://xumutv.com/script-master
SCRIPT_MASTER_SHARED_SECRET=<与 HOST_INTEGRATION_SECRET 完全相同>
SCRIPT_MASTER_LAUNCH_TTL_SECONDS=300
```

宿主 Caddyfile 必须包含 `/script-master` 代理及 Next.js 所需的内联启动脚本。当前本地 UI 分支在主站页内加载创作区，沿用同源 iframe 的 CSP 许可；独立打开仍保留整页工作台。其它主站页面仍保持原来的 CSP。界面和返回主站行为见 [HOST_WORKSPACE.md](HOST_WORKSPACE.md)。

发布宿主时必须同时加载两个 env 文件，防止选中旧的 `:local` 镜像：

```sh
docker compose --env-file deploy/demo.env --env-file deploy/release.env -f compose.demo.yml up -d --no-build --no-deps --force-recreate api web
```

本次连接配置不需要重启媒体 Worker。后续宿主发布使用不同 Compose 项目名，不会把
独立服务作为 orphan 移除。停机维护删除宿主网络前，先处理连接该网络的独立前端。

## 验证、备份与回滚

验证主站 health/readiness、两个新服务 health、未登录 API/工作台/Admin 拦截，
再使用主站登录从功能栈进入工作台。检查标签、创建/保存/刷新、不同账号隔离，以及
超过五分钟后票据续期。付费生成必须另行明确授权；静态资源和模拟测试不能证明模型质量。

后续发布先对独立数据库执行 `pg_dump --format=custom`，保存原镜像标签、源码版本和密钥
文件备份。迁移后再切镜像；健康失败时还原镜像和连接配置。涉及不向后兼容的数据迁移时，
按备份恢复独立数据库，不能只回退程序。首次上线失败可先恢复宿主未配置状态，保留独立
数据库供诊断，不删除用户数据。

源包：`python deploy/package.py /tmp/script-master-source.tgz`，只包含 Git 中的服务源码、
迁移与测试，排除密钥、构建目录和开发运行数据。`--candidate` 仅用于测试未提交改动。

已知边界：实验采集/评估结果仍为进程内存持久期；账号隔离不会自动变成组织协作共享。
独立生成仍遵循原来的前端调度与后端检查点设计；未新增后台脱离浏览器的全剧任务队列。
独立入口可原样导出；新版批量交接使用主站 v2 导入事务、来源分集映射和目标选择，详见 [HOST_BULK_IMPORT.md](HOST_BULK_IMPORT.md)。
