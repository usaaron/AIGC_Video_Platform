# API

Fastify + TypeScript 后端，默认监听 `http://127.0.0.1:8787`，所有业务接口使用 `/api/v1` 前缀。

```bash
cp .env.example .env
pnpm --filter @seqora/api dev
```

模块通过 `app.ts` 装配依赖。新增业务时创建独立 `modules/<name>`，保持 Route、Service、Repository/Provider 边界。
