# KOL CRM 完整版部署（抖音）

本版本由三个部分组成：中心网页、中心 Worker、员工电脑上的达人采集助手。MySQL 保存共享达人库和任务状态；Chrome 与 MediaCrawler 只在领取任务的员工电脑运行。

## 一、中心服务器

1. 安装 Ubuntu 22.04/24.04、Node.js 22、PM2、Nginx。
2. 解压服务器 ZIP，执行 `npm ci`、`npx prisma generate`、`npm run build`。
3. 从 `.env.production.example` 创建 `.env.production`，填写数据库、AI 密钥和随机生成的 `CENTRAL_AGENT_TOKEN`。
4. 对现有数据库执行一次 `deploy/migrations/20260825_local_agent_channel.sql`。
5. 启动两个进程：

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
```

6. 配置 Nginx 和有效 HTTPS 域名。员工 Agent 必须能通过 HTTPS 主动访问中心站。

## 二、员工采集助手

1. IT 在便携包的 `central-agent.conf` 中填写：

```ini
CENTRAL_APP_URL=https://实际中心域名
CENTRAL_AGENT_TOKEN=与服务器完全相同的随机密钥
CENTRAL_AGENT_NAME=业务一组-张三
```

2. 将整个便携文件夹压缩后分发，员工解压并双击 `达人采集助手.exe`。
3. 员工无需安装 Node.js 或 Python，但必须安装 Google Chrome。
4. 首次执行抖音任务时，在助手打开的专用 Chrome 中登录抖音。

## 三、业务操作

1. 打开中心网页的 Agent 页面，选择抖音品类任务。
2. “在这台电脑采集”应显示员工配置的名称和“在线”。
3. 设置目标精选人数、轮次、作品与 AI 预算，启动完整流程。
4. 中心 Worker 负责循环与数据库处理；采集、主页补齐、视频复访和私信发送会下发到所选员工电脑。
5. 未达到精选目标时按现有轮次与预算规则继续采集，达到目标或任一安全上限后停止。

## 四、上线验收

- `/api/health` 返回数据库已连接。
- PM2 中 `kol-crm-web`、`kol-crm-worker` 均为 online。
- 员工 EXE 启动后，网页能在 10 秒内显示该采集助手在线。
- 启动 1 条小数量抖音任务，Chrome 只在所选员工电脑打开。
- 采集结果、画像、待选/精选状态能在另一台电脑的中心网页看到。
- 私信发送成功后，达人状态和发送日期写入共享数据库。

小红书接口代码暂时保留用于后续开发，但本次不作为上线能力验收，也不向业务承诺可用。
