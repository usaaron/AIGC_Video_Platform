# 安全策略

## 私密报告漏洞

不要在公开 Issue 中提交 API Key、用户数据、支付信息或可直接利用的漏洞细节。

请使用 GitHub Private Vulnerability Reporting：

1. 打开仓库的 **Security > Advisories**。
2. 选择 **Report a vulnerability** 或 **New draft security advisory**。
3. 提供影响范围、复现步骤、受影响版本和建议修复方式。

直接入口：[新建私密安全报告](https://github.com/usaaron/AIGC_Video_Platform/security/advisories/new)。仓库所有者需要在 GitHub 的 **Settings > Security > Private vulnerability reporting** 中启用该功能。

## 开发要求

- 任何密钥只能保存在本地环境变量或部署平台的 Secret 中。
- `VITE_` 前缀变量会进入浏览器构建，不能放置服务端密钥。
- 会员权限、并发限制、积分扣减和支付回调必须在后端校验。
- 日志不得记录完整提示词中的个人敏感信息、第三方访问令牌、Cookie、session secret 或密码重置 token。
- 管理员端只能调用受权限保护的 API；前端隐藏入口不能替代后端 `requirePermission`、owner/admin 边界和审计日志。
- Postgres 备份、JSON 备份和 GCS 对象版本都可能包含用户数据，必须按私密生产数据处理。
- 依赖升级必须通过 CI，并检查高危漏洞和破坏性版本变更。
- 公网环境必须启用 HTTPS、唯一 `AUTH_SECRET` 和唯一首次账号密码，禁止使用仓库默认账号。
- API 端口不得直接暴露公网；通过受信任反向代理访问并启用 `TRUST_PROXY=true`。
- 模型平台和云平台必须配置预算告警、最小权限 Service Account 和私有对象存储。
