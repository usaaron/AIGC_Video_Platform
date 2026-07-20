# 参与开发

## 开始之前

1. 安装 Node.js 22 和 pnpm 11。
2. 执行 `pnpm install`。
3. 从最新的 `main` 创建分支。
4. 复制 `.env.example` 为 `.env.local`；Demo 模式可以保持为空。

## 分支与提交

分支使用 `<type>/<short-description>`，例如 `feat/storyboard-editor`、`fix/queue-retry`。

提交信息使用 Conventional Commits：

- `feat: add storyboard prompt editor`
- `fix: enforce member concurrency limit`
- `refactor: extract generation provider`
- `docs: update local setup`
- `test: cover failed generation jobs`
- `chore: upgrade vite`

每个 PR 只解决一个主题。禁止直接向 `main` 推送功能代码，至少需要一位成员 Review，并等待 CI 通过。

## 本地检查

`pnpm check` 是统一提交前标准。开发过程中可以单独运行 `pnpm lint`、`pnpm test` 或局部测试定位问题，但提交和发起 PR 前必须执行完整检查：

```bash
pnpm check
```

CI 使用同一个命令作为质量门禁，不维护另一套检查口径。UI 变更还需要手动检查桌面端和 390px 宽度移动端。涉及积分、并发或任务状态的变更必须添加单元测试。

## 完成标准

- 验收条件全部满足，失败和空状态可用。
- 不在前端保存密钥，不绕过后端积分与权限校验。
- 新逻辑位于正确模块，没有复制已有常量或领域规则。
- 测试、格式检查、Lint 和生产构建全部通过。
- 用户可见变化已在 PR 中附截图或录屏。
