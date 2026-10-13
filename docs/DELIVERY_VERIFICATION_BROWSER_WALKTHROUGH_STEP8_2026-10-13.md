# 交付验证第八步：真实浏览器走查

2026-10-13 在本地 `http://127.0.0.1:5183/` 完成交付核验弹层的真实浏览器走查。

## 走查范围

- 进入已有项目“地球末日:星海边界|海外60集验收”的生成队列。
- 使用一条临时冻结合同夹具验证入口；夹具只写入本地预览数据，走查结束后已恢复原文件并重启 8787 API。
- 点击“查看交付核验”，确认弹层展示只读合同事实、总体状态、要求 ID、合同哈希前缀和证据数量。
- 点击“关闭交付核验”，确认弹层与遮罩从页面移除。
- 全程未提交业务表单、未调用 Provider、未扣费或发布。

## 发现并修复的问题

生成页自身带有入场动画，动画的 `transform` 会让页面内的 `position: fixed` 弹层以整页为包含块，导致弹层被定位到长队列底部。现将交付核验弹层通过 React Portal 挂到 `document.body`，保持遮罩和弹层相对于视口居中。

## 实测结果

- 冻结合同任务行显示“查看交付核验”。
- 弹层正常居中打开，显示“存在失败要求”；本次夹具的 `task-completed` 已通过、`media-url` 待补证据、`physical-review` 失败，证据 6 条。
- 关闭按钮可用；关闭后 `.delivery-verification-modal` 与 `.modal-backdrop` 均不存在。
- 走查夹具已移除；恢复后的原任务不带交付合同，API 只读查询仍返回 `contract: null`，预览数据没有留下走查写入。

## 验证命令

- `apps/web/node_modules/.bin/vitest.cmd run src/pages/GenerationPage.test.jsx src/components/ui.test.jsx`：2 个文件、9 个测试通过。
- `apps/web/node_modules/.bin/vite.cmd build`：构建通过。

## 当前边界

这一步只验证读取、展示和关闭交互；交付发布、Provider 调用、扣费和自动门禁仍未接入。
