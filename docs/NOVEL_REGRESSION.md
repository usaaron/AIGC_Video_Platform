# 小说样本回归验收

本文件记录 `边城.txt` 和 `倾覆之塔.txt` 作为小说改编链路验收样本的使用方式。真实小说全文只放在本机或受控测试环境，不提交 Git。

## 样本定位

- `边城.txt`：中短篇质量样本，用于检查章节识别、下载站头尾清理、章节预览、摘要质量和故事概要可读性。
- `倾覆之塔.txt`：长篇压力样本，当前作为单文件上传大小上限参考，用于检查固定分块、自动重叠、不丢字符、边界检测和长任务队列稳定性。

## 默认路径

- `E:\Firefox下载\边城.txt`
- `C:\Users\Admin\Downloads\倾覆之塔.txt`

也可以用环境变量覆盖：

```powershell
$env:NOVEL_REGRESSION_BIANCHENG_PATH = "E:\Firefox下载\边城.txt"
$env:NOVEL_REGRESSION_TOWER_PATH = "C:\Users\Admin\Downloads\倾覆之塔.txt"
```

## 自动化回归

默认 `pnpm check` 不运行真实样本回归，避免 CI 依赖本机文件和长文本成本。需要手动显式开启：

```powershell
$env:RUN_NOVEL_FIXTURE_REGRESSION = "1"
$env:NOVEL_REGRESSION_BIANCHENG_PATH = "E:\Firefox下载\边城.txt"
$env:NOVEL_REGRESSION_TOWER_PATH = "C:\Users\Admin\Downloads\倾覆之塔.txt"
pnpm.cmd --filter @seqora/api test -- src/app.test.ts
```

当前样本回归只跑平台内部链路，不调用真实文本 Provider：

- `边城.txt`：预览切分、确认导入、正文不从公开详情返回、创建摘要队列。
- `倾覆之塔.txt`：验证文件大小不超过 `NOVEL_IMPORT_MAX_FILE_BYTES`、固定分块导入、自动重叠、字符覆盖、边界检测、创建可恢复摘要队列。

## 手动真实 Provider 验收

当需要检查摘要和故事概要质量时，再通过页面或专用脚本显式触发真实 Provider。建议先用 `边城.txt` 完整跑通摘要和故事概要，再用 `倾覆之塔.txt` 分批跑 24 块以内的摘要，观察失败重试、跳过和提交行为。

## 独立基准脚本

仓库根目录可以直接运行：

```powershell
pnpm.cmd regression:novel:biancheng
```

默认模式使用模拟文本 Provider，完整跑通：

- `边城.txt` 预览切分。
- 确认导入。
- 边界检测与边界说明。
- 摘要队列全量运行和提交。
- 故事概要生成。
- 摘要质量评分。

真实文本 Provider 小批量验收：

```powershell
pnpm.cmd regression:novel:biancheng:live -- --chunks=4
```

说明：

- 真实模式会读取 `apps/api/.env` 中的 `TOKENADVENT_API_KEY`、`TOKENADVENT_BASE_URL` 和 `TEXT_MODEL`。
- `--chunks` 限制为 2-4，默认 4，只摘要前几个分块。
- 真实模式不生成全书故事概要，只检查前 2-4 个摘要是否足够支撑“局部/第一篇章的大纲多方案生成”。
- 可用 `--path=...`、`--target=3000`、`--overlap=300` 覆盖样本路径和切分参数。
