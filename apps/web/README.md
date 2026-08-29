# Web

React + Vite 创作端，默认监听 `http://localhost:5173`，开发服务器将 `/api` 代理到本地 API。

```bash
cp .env.example .env.local
pnpm --filter @seqora/web dev
```

## 边界

页面不能直接实现权限、积分或跨组织规则；这些规则由 API 负责。前端只能根据 `/api/v1/auth/me` 返回的主体、角色和权限改善显示状态，不能把隐藏按钮当成授权。

`src/services/apiClient.js` 是唯一的 API 客户端入口。新增后端接口时，先更新 `@seqora/contracts` 和 API，再把调用封装到 `apiClient`，最后在页面中消费。

## 当前主要页面

- 登录页：处理账号密码登录和受控注册；用户输入 8 位邀请码和邮箱，先获取 6 位验证码，再提交显示名和至少 8 位密码。已有邮箱接受新组织邀请时输入原账号密码。
- 项目库与创作工作台：项目库、新建影片、概览、剧本、资产、分镜、生成队列、完整成片、账单和设置。
- 账号安全：自助改密、当前登录 session 列表、撤销指定 session。
- 个人资料：自助改密、个人 session、组织切换；owner/super_admin/admin/organization_admin 看到跳转独立管理员端的入口，普通成员和组织成员看不到后台入口。

剧本生成、续写、资产建议、图片、可信人像和视频都通过后台任务运行，页面不能把关闭编辑器或切换路由当成取消任务。项目库“对话一句成片 / 图片大师 / 剧本大师”、小说和长剧本入口当前为禁用或开发中，不要把占位卡片连接到生产 Provider。

分镜页默认使用“按场次智能生成”，每个剧本场次对应一个视频镜头；“高级：动作级细拆”只供用户主动细拆明确动作。网剧剧本页按“单集生成”工作，每次固定生成 1 集；长篇内容进入“长剧本生成”分组。已完成视频直接在分镜卡片缩略区播放，版本历史仅用于查看和恢复当前版/上一版。

后台管理能力统一放在 `apps/admin`：

- 组织改名、禁用、更换组织负责人、退出组织。
- 成员列表、创建组织用户、添加已有用户、角色修改、禁用 membership。
- 组织 session 列表和踢下线。

所有会改变权限、成员状态、组织状态或 session 状态的操作必须弹出二次确认。owner 才能任命超级管理员；owner/super_admin 才能任命管理员和组织管理员；admin 只能管理普通成员；organization_admin 只能管理组织成员。

## 验证

```bash
pnpm --filter @seqora/web lint
pnpm --filter @seqora/web test
pnpm --filter @seqora/web build
```

UI 变更至少检查桌面宽度和 `390px` 移动宽度，确保没有横向溢出、按钮文字截断或内容遮挡。
