# 筝音慧鉴微信小程序

这是小程序端第一阶段实现：用户必须先通过微信登录或手机号授权登录，登录成功后才能进入已部署的音色分析网页。

## 使用前配置

1. 使用微信开发者工具导入 `miniprogram/` 目录。
2. 在 `project.config.json` 中填写你的小程序 `appid`。
3. 在 `config.js` 中把 `apiBaseUrl` 和 `webviewUrl` 改成你的 HTTPS 域名。
4. 在微信公众平台配置服务器域名：
   - request 合法域名：你的 HTTPS 域名
   - 业务域名：你的 HTTPS 域名，用于 `web-view`

## 后端环境变量

服务器上的 Next.js 项目需要配置：

```bash
WECHAT_APPID=你的小程序 AppID
WECHAT_APPSECRET=你的小程序 AppSecret
MINIPROGRAM_SESSION_SECRET=建议使用 openssl rand -hex 32 生成
```

手机号授权能力仅对符合微信规则的小程序主体开放，开发时请确认小程序已认证并具备相关权限。
