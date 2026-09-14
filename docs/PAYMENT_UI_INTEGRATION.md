# 微信 / 支付宝支付界面接入说明

更新：2026-09-12。当前是前端模拟支付，未接入微信或支付宝商户接口，未部署生产。

## 页面与配置

- `apps/web/src/pages/RechargePage.jsx`：选择积分包和支付方式，点击充值后显示二维码窗口。
- `apps/web/src/pages/MembershipPage.jsx`：选择会员时长和支付方式，点击开通后显示相同支付窗口。
- `apps/web/src/features/billing/rechargeProducts.js`：积分包 ID、积分数、模拟金额。
- `apps/web/src/features/billing/membershipProducts.js`：会员方案 ID、月数、模拟金额和展示权益。
- `apps/web/src/features/billing/PaymentMethodSelector.jsx`：微信、支付宝单选控件。
- `apps/web/src/features/billing/paymentClient.js`：统一请求边界和模拟适配器。
- `apps/web/src/features/billing/usePaymentCheckout.js`：提交锁、失败反馈、离页终止请求。
- `apps/web/src/features/billing/MockPaymentDialog.jsx`：占位二维码、查询结果提示、键盘和关闭行为。

`amountFen` 单位是人民币分，8800 对应 88 元。修改配置会同步页面和模拟弹窗。商品 ID 必须唯一。删减档位会回退到第一个可用项；空列表禁用提交。

## 已预留的调用接口

两页已经调用以下异步方法，当前实现不发送网络请求：

```js
await paymentClient.createPayment(
  {
    productType: 'credits', // 'credits' | 'subscription'
    productId: 'credits-1000',
    paymentMethod: 'alipay', // 'wechat' | 'alipay'
    channel: 'qr',
  },
  { signal },
)

await paymentClient.queryPayment(payment, { signal })
```

`buildPaymentRequest` 只保留商品类型、商品 ID、支付方式和 `qr` 渠道，不透传客户端金额、积分数、权益或账户 ID。当前账户应由登录会话确定。

当前 `createPayment` 返回：

```js
{
  mode: 'mock',
  request: { productType: 'credits', productId: 'credits-1000', paymentMethod: 'alipay', channel: 'qr' },
  orderId: null,
  status: 'preview',
  title: '充值 1,000 积分',
  amountFen: 8800,
  qrImageUrl: '/images/payment-qr-placeholder.png',
}
```

`queryPayment` 返回 `{ mode: 'mock', status: 'preview', message }`。“我已支付”只显示该提示，不设置支付成功，也不改积分和套餐。关闭窗口仅结束本地预览，不代表取消真实订单。

## 后续正式接入

1. 先在 `packages/contracts` 定义微信、支付宝商品、创建订单和查询订单契约，再实现后端路由及 Service。现有 checkout 仍是 Stripe 契约，不能直接传入 `wechat` 或 `alipay`。
2. 后端校验当前账户、组织范围、商品和真实价格，生成订单并处理创建幂等。二维码渠道可以由服务端分别映射到微信 Native 和支付宝当面付预下单。
3. 在 `apps/web/src/services/apiClient.js` 增加受会话保护的请求方法，由 `paymentClient` 调用；将 `signal` 向下传递。不要让浏览器直接调用商户接口。
4. 增加正式支付窗口及订单状态处理：创建中、待支付、确认中、到账、失败、取消、过期。正式订单需要服务端订单 ID、准确金额、有效期和二维码内容；原始支付链接需要可靠的二维码库编码。
5. 当前 `usePaymentCheckout` 会拒绝 `mode !== 'mock'` 的返回，避免真实订单落入占位确认流程。正式接入时应连同完整状态处理一起替换此保护，不能只把模式改成 `mock`。
6. 服务端验证回调签名并幂等写入现有 ledger。客户端查到到账后通过 App 的 `refreshBilling` / `api.billing()` 刷新余额、套餐和流水；按钮点击或页面跳转都不能直接开通会员。
7. 增加订单查询、过期刷新、恢复未完成订单和明确的取消接口。离页终止前端请求不等于取消服务端订单。自动查询应在关闭、离页或切换账户时停止。
8. 手机 H5、微信 JSAPI、支付宝跳转支付需扩展渠道和返回契约，当前手机端仍是可查看的二维码占位预览。

会员月度、季度、年度目前是一次性模拟方案，不自动续费。正式接入前必须明确有效期、每月积分发放、到期和退款规则，不能直接套用现有 Stripe 自动续订语义。已有会员当前不支持重复开通或续费。

## 本次逻辑检查

- 个人账户：顶部余额进入充值，顶部套餐进入会员中心，账单、设置及生成队列入口保持可往返。
- 组织账户：顶部入口进入组织账单，侧栏隐藏个人购买，生成队列不展示个人升级；账单不再显示个人月度赠送权益。
- 后端的组织账单 `credits` 已等于共享池余额，顶部、侧栏和新增页面余额来源一致。
- 账户、组织范围或套餐改变时，App 重建购买页，清除待处理预览并终止未完成请求。
- 请求期间锁定选项和提交，弹窗固定本次商品及方式；关闭后允许重新选择。
- 缺少账单、空商品列表、加载/查询失败都有反馈，已有会员和组织账户不能提交个人开通。

## 验证

Web 49 个测试文件、241 项测试通过；Web lint 和 build 通过。测试涵盖支付参数、两种方式、两类商品、模拟查询不发网络请求、组织升级限制、空商品与账单缺失。
