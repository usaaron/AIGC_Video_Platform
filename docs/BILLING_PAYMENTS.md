# Billing Payments

本文记录当前真实支付沙箱的接入边界。当前实现使用 Stripe test mode，生产支付仍需要在 Stripe Dashboard 中创建正式价格、正式 webhook endpoint，并完成税务、发票、退款和风控运营规则确认。

## 设计原则

- 前端只能创建 checkout session 并跳转 Stripe 托管支付页，不能直接修改套餐、积分或权益。
- 套餐开通、续费、取消、积分充值和退款都必须由服务端 webhook 写入 Postgres ledger。
- 所有入账动作必须幂等，重复 webhook event 不得重复发放积分或重复扣减。
- webhook 必须校验 Stripe 签名，并使用原始请求 body。
- 后台管理员可在 `apps/admin` 查看账单账户、ledger 和支付对账记录；管理员充值/调账仍走后台 API，不走 Stripe。

## 环境变量

本地沙箱配置示例：

```bash
PAYMENT_PROVIDER=stripe
BILLING_SUCCESS_URL=http://localhost:5173/billing/success
BILLING_CANCEL_URL=http://localhost:5173/billing/cancelled
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_MEMBER_PRICE_ID=price_xxx
STRIPE_CREDIT_PRICE_ID=price_xxx
STRIPE_CREDIT_PACK_CREDITS=100
```

`PAYMENT_PROVIDER=none` 时，创作端账单页会显示支付未启用，后端 checkout API 返回 `PAYMENT_PROVIDER_NOT_CONFIGURED`。

## 本地沙箱验收

1. 启动本地依赖和服务：

```bash
pnpm dev
```

2. 使用 Stripe CLI 转发 webhook：

```bash
stripe listen --forward-to localhost:8787/api/v1/billing/webhooks/stripe
```

3. 把 CLI 输出的 `whsec_...` 写入 `STRIPE_WEBHOOK_SECRET`，重启 API。
4. 登录创作端 `http://localhost:5173`，进入账单页。
5. 点击“订阅会员”或“充值积分”，完成 Stripe test mode 支付。
6. 回到 5173 账单页刷新，确认 `GET /billing/summary` 中套餐、积分和 ledger 已更新。
7. 登录管理员端 `http://localhost:5174`，在账单页确认支付对账记录为 `processed`。

## 后端接口

- `GET /api/v1/billing/payment/configuration`：返回支付 provider、订阅和积分包是否启用。
- `POST /api/v1/billing/checkout/subscription`：为当前 membership 创建会员订阅 checkout。
- `POST /api/v1/billing/checkout/credits`：为当前 membership 创建积分包 checkout。
- `POST /api/v1/billing/webhooks/stripe`：Stripe webhook 入口，需要 `Stripe-Signature`。
- `GET /api/v1/admin/billing/reconciliation`：后台查询支付对账记录。
- `GET /api/v1/admin/console`：聚合返回 `billingPaymentReconciliation`。

兼容的内部测试 webhook `/billing/webhooks/:provider` 仍存在，但真实支付沙箱应使用 `/billing/webhooks/stripe`。

## 事件映射

| Stripe event                                | 内部事件                 | 结果                                |
| ------------------------------------------- | ------------------------ | ----------------------------------- |
| `checkout.session.completed` + subscription | `subscription.activated` | 套餐改为 `member`，发放会员月度积分 |
| `invoice.paid`                              | `subscription.renewed`   | 续费成功，发放会员月度积分          |
| `customer.subscription.deleted`             | `subscription.cancelled` | 套餐改为 `free`                     |
| `checkout.session.completed` + credits      | `credits.purchased`      | 发放固定积分包                      |
| `charge.refunded`                           | `payment.refunded`       | 按退款比例扣回积分                  |

退款扣回使用 DB ledger 和余额约束。如果用户已消费掉对应积分导致余额不足，webhook 会失败并写入 `billing_payment_reconciliation_items.status = failed`，需要管理员处理。

## 数据表

- `billing_payment_sessions`：记录 Stripe checkout session、subscription、payment intent、金额、币种和 metadata。
- `billing_payment_reconciliation_items`：记录每个 Stripe event 的处理状态、对应 ledger、membership 和错误消息。
- `billing_webhook_events` 与 `billing_ledger_entries`：继续作为业务入账和幂等账本来源。

## 生产上线前仍需补齐

- 在 Stripe Dashboard 配置正式 webhook endpoint 和正式 price，并锁定价格迁移流程。
- 增加订阅状态同步/补偿任务，处理 webhook 延迟或漏投。
- 明确退款时积分不足的运营处理：补扣、限制生成、人工调账或欠费状态。
- 增加发票、税务、支付失败重试、邮件通知和用户协议/隐私条款。
- 在监控中加入 failed reconciliation、webhook 5xx、重复事件和账单余额异常告警。
