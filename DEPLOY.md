# 古筝 AI 音色鉴赏网页部署说明

本项目是 Next.js 应用，包含 `/api/deepseek` 服务端接口，不能作为纯静态网页部署。服务器需要 Node.js 运行时，或使用 Docker。

## 方案一：Linux 服务器 + PM2 + Nginx

适合普通云服务器、宝塔面板、轻量服务器。

### 1. 服务器环境

- Node.js 20 LTS
- npm
- pm2
- nginx

```bash
npm install -g pm2
```

### 2. 上传代码并安装依赖

```bash
cd /www/wwwroot/guzheng-timbre-studio
npm ci
cp .env.production.example .env.production
```

编辑 `.env.production`，填入真实 API Key：

```bash
DEEPSEEK_API_KEY=你的真实Key
DEEPSEEK_MODEL=deepseek-chat
```

### 3. 构建并启动

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

本应用默认监听 `127.0.0.1:3000`，外部访问交给 Nginx 反向代理。

### 4. Nginx 配置示例

将 `your-domain.com` 改成你的域名：

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

配置 HTTPS 时，建议使用服务器面板或 certbot 自动签发证书。

### 5. 更新部署

```bash
git pull
npm ci
npm run build
pm2 restart guzheng-timbre-studio
```

## 方案二：Docker 部署

```bash
docker build -t guzheng-timbre-studio .
docker run -d \
  --name guzheng-timbre-studio \
  --restart unless-stopped \
  -p 3000:3000 \
  -e DEEPSEEK_API_KEY=你的真实Key \
  -e DEEPSEEK_MODEL=deepseek-chat \
  guzheng-timbre-studio
```

如需绑定域名，仍建议在宿主机 Nginx 中反向代理到 `127.0.0.1:3000`。

## 隐私与接口说明

- 用户上传音频的基础分析在浏览器内完成。
- 点击“生成 AI 报告”时，服务器接口只接收频谱、动态、共鸣、分段评分等结构化数据，不接收原始音频片段。
- `/api/deepseek` 已有基础 IP 频率限制，用于降低恶意刷 API 风险；正式生产可进一步接入 Cloudflare、Nginx 限流或验证码。
