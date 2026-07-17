# Web

React + Vite 创作端，默认监听 `http://localhost:5173`，开发服务器将 `/api` 代理到本地 API。

```bash
cp .env.example .env.local
pnpm --filter @seqora/web dev
```

页面不能直接实现权限、积分或跨租户规则；这些规则由 API 负责。
