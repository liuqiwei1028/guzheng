# 古筝 AI 音色鉴赏网页部署说明

本项目是 Next.js 应用，包含 `/api/deepseek` 服务端接口，不能作为纯静态网页部署。服务器需要 Node.js 运行时，或使用 Docker。

## 方案一：Linux 服务器 + PM2 + Nginx SSL

适合普通云服务器、宝塔面板、轻量服务器。

### 1. 服务器环境

- Node.js 20 LTS
- npm
- pm2
- nginx
- 已解析到服务器的域名
- SSL 证书，可以使用宝塔面板、云厂商证书或 certbot 申请

```bash
npm install -g pm2
```

### 2. 拉取代码并安装依赖

```bash
cd /www/wwwroot
git clone https://github.com/liuqiwei1028/guzheng.git guzheng-timbre-studio
cd /www/wwwroot/guzheng-timbre-studio
npm ci
cp .env.production.example .env.production
```

编辑 `.env.production`，填入真实 API Key：

```bash
DEEPSEEK_API_KEY=你的真实Key
DEEPSEEK_MODEL=deepseek-chat
WECHAT_APPID=你的小程序AppID
WECHAT_APPSECRET=你的小程序AppSecret
MINIPROGRAM_SESSION_SECRET=建议使用 openssl rand -hex 32 生成
```

### 3. 构建并启动 Next.js

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

本应用默认监听 `127.0.0.1:3000`，外部访问交给 Nginx HTTPS 反向代理。

## 4. Nginx SSL 配置示例

将 `your-domain.com` 改成你的域名，并把证书路径改成服务器上的真实路径。

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name your-domain.com www.your-domain.com;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    client_max_body_size 220m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

如果使用宝塔面板：

1. 站点目录可指向项目目录，但不要把它当 PHP 静态站点运行。
2. 在站点设置中开启 SSL。
3. 在反向代理中配置目标 URL：`http://127.0.0.1:3000`。
4. 确认强制 HTTPS 已开启。

修改 Nginx 配置后执行：

```bash
nginx -t
systemctl reload nginx
```

## 5. 更新部署

```bash
cd /www/wwwroot/guzheng-timbre-studio
git pull
npm ci
npm run build
pm2 restart guzheng-timbre-studio
```

## 6. 微信小程序配置

小程序代码位于 `miniprogram/` 目录。

开发者工具配置：

1. 用微信开发者工具导入 `miniprogram/`。
2. 将 `miniprogram/project.config.json` 中的 `appid` 改成真实小程序 AppID。
3. 将 `miniprogram/config.js` 中的 `apiBaseUrl` 和 `webviewUrl` 改成正式 HTTPS 域名。
4. 在微信公众平台配置：
   - request 合法域名：正式 HTTPS 域名
   - 业务域名：正式 HTTPS 域名，用于 `web-view`

登录说明：

- 微信登录使用小程序 `wx.login`，服务端通过微信 `code2Session` 换取 openid。
- 手机号登录使用 `button open-type="getPhoneNumber"` 获取一次性 code，服务端换取手机号后只写入脱敏手机号和哈希，不保存原始手机号。
- 登录成功后，小程序进入 `web-view`，加载已部署的网页功能页。

## 方案二：Docker 部署

```bash
docker build -t guzheng-timbre-studio .
docker run -d \
  --name guzheng-timbre-studio \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e DEEPSEEK_API_KEY=你的真实Key \
  -e DEEPSEEK_MODEL=deepseek-chat \
  -e WECHAT_APPID=你的小程序AppID \
  -e WECHAT_APPSECRET=你的小程序AppSecret \
  -e MINIPROGRAM_SESSION_SECRET=请使用随机长字符串 \
  guzheng-timbre-studio
```

如需绑定域名，仍建议在宿主机 Nginx 中启用 SSL，并反向代理到 `http://127.0.0.1:3000`。

## 隐私与接口说明

- 用户上传音频的基础分析在浏览器内完成。
- 点击“生成 AI 报告”时，服务器接口只接收频谱、动态、共鸣、分段评分等结构化数据，不接收原始音频片段。
- `/api/deepseek` 已有基础 IP 频率限制，用于降低恶意刷 API 风险；正式生产可进一步接入 Cloudflare、Nginx 限流或验证码。
