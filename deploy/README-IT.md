# 给 IT：KOL CRM 完整版部署说明（无 Docker）

请优先阅读同目录的 `README-FULL-DEPLOY.md`。本版本已经包含员工本地 Agent 的中心任务通道，必须同时启动网页和 Worker。

部署完成后的架构解释、故障归属和重启方法见 `README-IT-OPS.md`。

## 服务器要求

- Ubuntu 22.04/24.04 x64，Node.js 22 LTS、PM2、Nginx。
- 入站开放 80/443；3000 不对公网开放。
- 出站允许访问公司 MySQL 3306、npm 软件源和 Prisma 引擎下载站。
- 提供有效 HTTPS 域名，员工 Agent 通过 HTTPS 主动连接中心站。

## 首次部署

```bash
sudo mkdir -p /opt/kol-crm
sudo chown -R "$USER":"$USER" /opt/kol-crm
unzip kol-crm-server-20260825.zip -d /opt/kol-crm
cd /opt/kol-crm/kol-crm-server-20260825
npm ci
npx prisma generate
cp .env.production.example .env.production
chmod 600 .env.production
```

通过公司安全渠道填写 `.env.production`。`CENTRAL_AGENT_TOKEN` 使用至少 32 字节的随机值，并与员工包 `central-agent.conf` 完全一致。

现有数据库已包含业务数据，不得清库，不执行测试数据脚本。依次执行以下迁移：

```bash
mysql --host=数据库地址 --user=数据库用户 -p biz_cpyx_db < deploy/migrations/20260825_local_agent_channel.sql
mysql --host=数据库地址 --user=数据库用户 -p biz_cpyx_db < deploy/migrations/20260826_task_outreach_status.sql
```

随后构建并启动：

```bash
npm run build
sudo npm install -g pm2
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 status
curl http://127.0.0.1:3000/api/health
```

PM2 中 `kol-crm-web` 与 `kol-crm-worker` 必须同时为 `online`。

## Nginx

根据真实域名修改 `deploy/nginx-kol-crm.conf`，安装配置并启用 HTTPS。部署完成后，请把最终中心网址安全地提供给项目维护人员，用于生成员工 Agent 配置。

## 安全要求

- 部署 ZIP 不包含数据库密码、AI 密钥或员工浏览器数据。
- `.env.production` 权限保持 600，不发送到群聊，不提交 Git。
- MySQL 3306 不对公网全开放，只允许中心服务器出口 IP。
- 员工电脑不持有数据库账号；所有共享数据操作均通过中心网页完成。
