# 微信支付页面交接文档

## 微信 / 支付宝补充（2026-09-12）

充值和会员两页已支持选择微信或支付宝，选好商品后提交才显示对应的二维码占位窗口。共用接入边界位于 `apps/web/src/features/billing/paymentClient.js`；参数、返回值、组织入口修正及后续正式接入事项见 [PAYMENT_UI_INTEGRATION.md](./PAYMENT_UI_INTEGRATION.md)。当前仍不生成真实订单、扣款或变更权益。以下较早说明中的单一微信方式，以本节为准。

## 最新页面调整（2026-09-11）

产品方已确认：充值改为独立页面，展示多档“积分 / 人民币价格”；暂用模拟数据，选好后点击充值才弹二维码，微信正式接入前使用不可付款的占位图片。此要求优先于本文后续关于未配置价格及二维码展示的旧建议。

- 新页面：`apps/web/src/pages/RechargePage.jsx`，样式：`RechargePage.css`。
- 会员页面：`apps/web/src/pages/MembershipPage.jsx`，方案配置：`apps/web/src/features/billing/membershipProducts.js`。
- 六档模拟商品：`apps/web/src/features/billing/rechargeProducts.js`，修改 `credits` 和 `amountFen` 即可调整积分与价格（金额单位为分）。
- 占位图片：`apps/web/public/images/payment-qr-placeholder.png`。
- 侧栏新增“积分充值”，顶部积分余额可直达；账单页保留账户概览与积分明细，和充值页互相导航。
- 演示不调用真实 checkout，不生成订单号；“我已支付”不会确认付款，也不改动余额。组织共享池继续由后台充值。
- 会员页提供月度、季度、年度三档模拟方案，已有会员禁用重复开通，免费账号选择后弹出同一微信二维码占位窗口。
- 后续真实微信下单、查询、关闭订单、回调验签与账本入账仍需服务端实现。本地页面改动尚未部署。

## 交接目的

下一次会话先完成创作端的支付页面和支付交互原型，之后再回到本会话继续做微信支付后端、商户配置、回调验签和真实支付联调。

本阶段的页面必须遵守现有账单规则：客户端不能自行增加积分、开通会员或把“跳转成功”当作支付成功。真实权益只能由服务端收到并验证微信支付回调后写入 Postgres billing ledger。

## 当前仓库状态

- 仓库：`C:\Users\admin\Desktop\图片\aigc-studio-demo`
- 当前分支：`main`
- 当前 HEAD：`aeb0051 fix: unblock storyboard batch video submission`
- 当前工作区在本次文档创建前是干净的
- 预发候选分支：`codex/demo-reliability-ui`
- 预发候选最新提交：`422cde1 chore: capture preprod candidate changes`
- 生产站点域名：`https://xumutv.com`
- 预发容器目前已停止

进入新会话后，先执行：

```powershell
Set-Location 'C:\Users\admin\Desktop\图片\aigc-studio-demo'
git status --short --branch
git log -1 --decorate --oneline
```

不要把 API 密钥、微信 APIv3 密钥、商户私钥、证书私钥或真实账号密码写进代码、测试数据和本文件。

## 当前支付实现

当前项目已经有账单和积分账本，但支付适配器还是 Stripe 结构：

- `apps/web/src/pages/BillingPage.jsx`：显示余额、套餐、积分明细和支付入口。
- `apps/web/src/services/apiClient.js`：已有支付配置、会员 checkout 和积分 checkout 请求。
- `apps/api/src/modules/billing/routes.ts`：已有支付配置、checkout 和 Stripe webhook 路由。
- `apps/api/src/modules/billing/paymentProvider.ts`：当前只实现 Stripe provider。
- `apps/api/src/modules/billing/paymentService.ts`：负责支付订单、webhook、对账和账本入账编排。
- `apps/api/src/modules/billing/paymentRepository.ts`：负责支付会话和对账记录持久化。
- `apps/api/src/infra/migrations/019_billing_payment_sessions.sql`：已有支付会话和支付对账表。
- `packages/contracts/src/billing.ts`：当前 `billingPaymentProviderSchema` 只允许 `stripe`。

当前接口：

```text
GET  /api/v1/billing/summary
GET  /api/v1/billing/payment/configuration
POST /api/v1/billing/checkout/subscription
POST /api/v1/billing/checkout/credits
POST /api/v1/billing/webhooks/stripe
```

当前 `PAYMENT_PROVIDER=none` 时，账单页显示“支付未启用”，支付按钮不可用。微信支付尚未接入，不能假设这些接口已经返回微信二维码或 H5 跳转地址。

## 本次页面任务

### 页面目标

将现有账单页完善成可以用于商户审核和后续真实支付接入的支付界面，至少支持：

1. 展示当前套餐、余额、积分消耗说明和可购买商品。
2. 选择会员套餐或积分包，并显示订单摘要、价格和获得权益。
3. 展示微信支付作为支付方式。
4. 在桌面端预留 Native 二维码支付状态。
5. 在移动端预留 H5/JSAPI 跳转状态。
6. 清楚区分待支付、支付处理中、支付成功、支付失败、订单取消和订单过期。
7. 支付完成后提示“正在确认到账”，通过刷新账单数据显示最终余额，不在前端直接写入积分。
8. 在接口未配置、接口请求失败和支付订单过期时给出可理解的页面状态。

### 建议页面结构

建议优先改造 `apps/web/src/pages/BillingPage.jsx`，沿用现有 AppShell、PageHeader、按钮和图标体系，不另外制作营销型落地页。

页面可以包含以下区域：

- 当前账户概览：当前套餐、可用积分、本月消耗。
- 商品选择区：会员套餐、积分包，卡片中展示名称、价格、权益和购买按钮。
- 订单确认区：商品名称、数量、应付金额、获得积分或会员权益。
- 支付方式区：微信支付；桌面端显示二维码容器，移动端显示“继续支付”按钮容器。
- 支付状态区：等待扫码、等待微信确认、支付成功待入账、支付失败、订单已取消或已过期。
- 账单明细区：继续保留现有积分 ledger。

价格不要凭空写死成最终商业价格。当前仓库没有完整的正式价格配置，建议把商品定义为页面顶部的可替换配置或 props，方便后端价格接口接入。若为了审核页面必须展示价格，使用产品方确认的真实价格，并确保与商户平台经营场所简介中的价格区间一致。

## 支付方式设计

生产域名是 `xumutv.com`。后端完成后，支付方式大致如下：

```text
PC 浏览器      -> Native 支付 -> code_url -> 页面显示二维码
手机普通浏览器 -> H5 支付     -> h5_url   -> 跳转微信支付
微信内置浏览器 -> JSAPI 支付  -> prepay_id -> 调起微信支付
```

本次页面只需要把这三种状态和入口设计好。不要在没有真实后端返回值时生成假二维码、假订单号或模拟自动到账。

建议抽象成类似以下前端数据结构，但可以根据现有代码风格调整：

```js
{
  productType: 'credits' | 'subscription',
  productId: 'credit-pack-100',
  title: '100 积分包',
  amountFen: 0,
  paymentMethod: 'wechat',
  channel: 'native' | 'h5' | 'jsapi',
  status: 'idle' | 'creating' | 'awaiting_payment' | 'verifying' | 'paid' | 'failed' | 'cancelled' | 'expired',
}
```

金额显示必须使用人民币元，后端支付接口最终使用分。前端不能接受用户输入的任意金额作为支付金额，商品和金额必须由服务端确认。

## 页面行为要求

- 点击购买后锁定当前操作，避免重复创建订单。
- 未登录或账单加载失败时，不能展示可提交的支付订单。
- 用户取消支付后允许重新发起订单。
- 支付成功页面只展示“支付结果待确认”或从服务端读取到的已确认状态。
- 余额和 ledger 刷新应通过现有 `api.billing()`，不能在 React state 中直接加积分。
- 支付配置关闭时，页面要有清晰的不可用状态，但仍可以展示商品说明。
- 组织共享账单用户继续显示“组织池由后台充值”，不要开放个人支付入口。
- 会员已经是 `member` 时，不显示重复订阅按钮。
- 移动端不能依赖悬浮层才能完成主要操作；二维码区域、按钮、错误文字和长商品名都要适配窄屏。
- 测试和 UI 原型不能打印敏感配置，也不能把支付签名、私钥或 APIv3 密钥放到浏览器。

## 视觉和交互要求

- 延续当前创作工作台的中文界面和已有主题，不重新设计整站。
- 支付区域应让用户第一眼看到商品、金额、支付方式和当前状态。
- 二维码容器使用稳定尺寸，避免二维码加载前后页面跳动。
- 按钮要有 loading、disabled 和错误恢复状态。
- 使用项目已有的 Lucide 图标和按钮样式。
- 需要加入键盘焦点、`aria-live` 状态提示和足够的颜色对比度。
- 不要展示“支付成功”作为静态装饰文案，除非它来自明确的服务端状态。

## 建议验证

完成页面后至少运行：

```powershell
pnpm --filter @seqora/web test -- --run
pnpm --filter @seqora/web build
```

如果仓库脚本名称不同，先查看根目录和 `apps/web/package.json`，使用项目实际脚本。重点验证：

- 账单页现有测试仍然通过。
- 未配置支付时页面可读且按钮状态正确。
- 选择会员和积分包时订单摘要正确切换。
- 重复点击不会产生多个前端请求。
- 桌面宽度和手机宽度没有溢出或遮挡。
- 支付失败、取消、过期和处理中状态可恢复。

## 回到本会话后的后续工作

页面完成后，再继续以下后端工作：

1. 在 contracts 中增加 `wechat` provider 和 Native/H5/JSAPI checkout 返回结构。
2. 增加微信支付 APIv3 签名客户端和 Native、H5、JSAPI 下单能力。
3. 增加微信回调路由，例如 `POST /api/v1/billing/webhooks/wechat`。
4. 校验微信回调签名并用 APIv3 密钥解密通知。
5. 按微信交易号和通知 ID 做幂等处理，成功后写入现有 Postgres ledger。
6. 增加支付订单查询、关闭订单、退款和异常对账处理。
7. 增加生产环境变量和受限权限的商户私钥文件配置。
8. 在 `https://xumutv.com` 上联调回调地址、PC Native、手机 H5，以及微信内置浏览器 JSAPI。
9. 增加后端单测、支付回调重复通知测试和真实小额支付验收。

商户平台相关域名：

- H5 支付域名：`xumutv.com`
- JSAPI 支付授权域名：`xumutv.com`
- JSAPI 支付授权目录：`https://xumutv.com/`
- 微信支付回调地址：以后端实际路由为准，例如 `https://xumutv.com/api/v1/billing/webhooks/wechat`

## 新会话的启动提示

新会话可以直接使用下面这句话开始：

> 请先阅读 `docs/WECHAT_PAYMENT_UI_HANDOFF.md`，在当前仓库完成创作端微信支付页面和响应式交互原型。先沿用现有 BillingPage 和账单 API，不实现真实微信签名、下单和回调；支付成功不能由前端直接确认或增加积分。完成后运行相关 Web 测试和构建，并说明修改文件、测试结果和后端接入待办。
