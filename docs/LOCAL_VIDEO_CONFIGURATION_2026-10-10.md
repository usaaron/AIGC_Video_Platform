# 本地视频配置与假成功修复

2026-10-10。本次作用于主项目分支 `codex/script-host-ux-20260920` 的5183本地预览，未发布线上。

## 原因与行为

本地 API 启动脚本只加载图片配置，没有加载旧主项目已有的视频配置。`createVideoProvider` 因无密钥返回空，任务创建仍扣费，Worker 将 Seedance 任务走入演示输出，返回 JPG 却标记为 video/completed。因此第一集第一镜三次显示成功，实际没有远端视频任务；下一镜因缺尾帧失败。

现在 `GenerationService.createTask` 在真实视频 Provider 缺失时返回 `503 SEEDANCE_NOT_CONFIGURED`，在创建任务与扣费之前停止。Worker 对此前已排队或运行、落入本地模拟路径的视频按失败处理，并使用现有退款机制；图片演示路径及本地合成的归属保持原样。health 的缺视频配置状态改为 `unavailable`。

## 配置与运行

- 配置仍保存在被 Git 忽略的 `apps/api/.env`，仅迁入原有 `VIDEO_PROVIDER`、`DORA_ROUTER_BASE_URL`、`DORA_ROUTER_VIDEO_MODEL`、`DORA_ROUTER_API_KEY`。文档和报告不包含密钥。
- `../work/local-dark-preview-20260923/video-provider-config.mjs` 按白名单加载，进程环境变量优先；显式空值不回退文件值。两个本地 API 启动脚本均使用该加载器。
- 数据、认证、文本、支付及公网媒体地址不从旧环境导入。DoraRouter 视频密钥不会自动启用尚未配置的素材库。没有公网地址时，已有视频参考图读取机制使用受权限检查的本地原图数据。
- 原模型 `doubao-seedance-2-0-260128` 在 `/v1/models` 鉴权200的响应中存在。更新后的本地 API health 为 `dora-router-seedance`，图片配置正常，其他服务进程保持。

## 历史数据修复

`../work/video-provider-repair-20261010/repair-core.mts` 只允许事先确认的三条任务：Seedance、没有 providerTaskId/providerName、演示 JPG 输出、没有存储输出、未选为有效媒体、存在原扣费流水。修复保留原输出到审计元数据，将状态改为失败并清空不可播放结果；通过 `StoreCreditLedger.refundGenerationInState` 原子退回三笔各18积分，共54积分。重复运行不会重复退款。

执行前先停止确认身份的唯一8787 API并保存本地数据备份。第一次操作被旧进程遗留锁拦截，未写数据且 API 已恢复；确认锁属于已退出API后清理该单个锁，第二次维护成功。维护脚本已补充相同的锁归属检查。最终API恢复，60集正文、1587镜、127资产、其他任务、媒体及其他数据逐项保持。原第四条失败视频此前已经退款，本次未更改。

数据备份和运行报告位于支持工作区，不纳入 Git。不要重放全量分镜交接来处理视频问题。

## 验证

- 视频可用性、GenerationService、任务执行器及 DoraRouter Provider：4文件69测试通过。
- 图片/视频配置隔离和优先级：6测试通过。
- 历史退款工具：3测试通过，覆盖原扣费退款、幂等、真实任务与已选媒体保护。
- API隔离输出目录构建及lint通过；没有覆盖共享构建产物。
- 现网本地API读回：视频已配置；三条修复任务失败且已退款，原第四条保持；没有活动媒体任务。
- Postgres账本集成测试尝试执行，但 Docker 引擎未启动，4项未运行；本地使用的JSON账本已由上述测试和实际修复核验。
- 尚未提交收费视频生成；鉴权与代码测试不代表已经验证真实成片可播放。
