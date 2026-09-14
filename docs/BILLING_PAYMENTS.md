# Billing Payments

本文记录当前真实支付沙箱的接入边界。当前实现使用 Stripe test mode，生产支付仍需要在 Stripe Dashboard 中创建正式价格、正式 webhook endpoint，并完成税务、发票、退款和风控运营规则确认。

## 当前充值页面（2026-09-11）

创作端使用独立的 `RechargePage` 展示六档积分包，用户选好额度与微信/支付宝后点击“立即充值”，弹出对应支付窗口。`BillingPage` 保留账户概览和流水，刷新仍使用 `api.billing()`。个人账户可从侧栏“积分充值”、顶部积分余额和账单页按钮进入充值页面。

创作端另有独立的 `MembershipPage` 会员中心，展示月度、季度和年度会员方案；会员权益沿用当前规则，每月 500 积分、最多 3 路并发。免费账号可以选择方案和微信/支付宝并打开占位弹窗，已有会员显示已开通并引导充值积分。

当前产品方已允许使用模拟价格和二维码占位图。`apps/web/src/features/billing/rechargeProducts.js` 中的 `RECHARGE_PACKS` 是展示配置，`credits` 为积分数，`amountFen` 为人民币分（例如 8800 对应 88 元）。占位图片为 `apps/web/public/images/payment-qr-placeholder.png`。

这些页面不调用 checkout，不受 Stripe 配置影响；“我已支付”只提示真实支付尚未接入，不会确认成功或增加权益。组织共享账单不开放个人充值或会员开通。以后接入微信/支付宝时，服务端必须提供正式商品、价格、订单和支付凭证，不能将这里的模拟金额直接用于收费。

2026-09-12：已增加共用的 `paymentClient.createPayment` / `queryPayment` 前端接口边界、提交锁与离页请求终止；当前仍为模拟适配器。组织账户的顶部入口转到账单，生成页隐藏个人升级。具体参数与正式接入待办见 [PAYMENT_UI_INTEGRATION.md](./PAYMENT_UI_INTEGRATION.md)。下文 Stripe 设计原则仅适用于已有 Stripe 沙箱链路。

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

`PAYMENT_PROVIDER=none` 时，后端 checkout API 返回 `PAYMENT_PROVIDER_NOT_CONFIGURED`。前端模拟充值页仍可预览档位和占位弹窗，不代表真实支付已启用。

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
4. 使用已登录的测试会话，通过下方 checkout API 创建 Stripe test mode 支付会话。
5. 打开 API 返回的 Stripe 托管支付地址并完成测试支付。当前充值页面只提供微信/支付宝占位演示，不跳转 Stripe。
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
