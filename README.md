# KOL CRM Next.js MVP

这是一个用 kol-claw CSV 数据模拟的 Next.js 达人 CRM 原型。

## 已有功能

- 读取 `data/creators.csv`
- 展示达人库列表
- 支持达人搜索、平台筛选、状态筛选、评级筛选、优先级筛选
- 统计达人总数、已建联、未建联、优先联系
- 计算稳定播放量
- 计算当前 CPM
- 按目标 CPM 15 计算建议报价
- 自动给达人做 S/A/B/C/D 评级
- 按优先级排序建联名单

## 页面

- `/`：仪表盘
- `/creators`：达人库
- `/creators/:id`：达人详情
- `/tasks`：建联任务

## 启动方式

在 VS Code 打开这个文件夹：

```text
C:\Users\EDY\Documents\Codex\2026-07-07\3-2-x-s-k-nk\work\kol-crm-next
```

打开终端后执行：

```powershell
pnpm install
pnpm dev
```

浏览器打开：

```text
http://localhost:3000
```

如果浏览器出现 `Cannot find module './617.js'` 这类缓存错误，先停掉开发服务，再重新运行 `npm run dev`。项目已经配置为使用 `.next-dev` 目录，避免复用旧的 `.next` 缓存。

如果你的 VS Code 终端找不到 `pnpm`，可以先用：

```powershell
npm install
npm run dev
```

## 数据文件

当前模拟数据来自：

```text
data\creators.csv
```

后面你拿到真实达人数据，只要整理成同样字段，就可以替换这个 CSV。

## 接入 MySQL

项目已经支持 MySQL。没有配置 MySQL 时会继续读取 `data\creators.csv`；配置好 `DATABASE_URL` 后会优先读取 MySQL。

### 1. 安装 Prisma 依赖

如果你之前已经执行过 `npm install`，现在需要再执行一次，让新加的 Prisma 依赖装上：

```powershell
npm install
```

### 2. 创建 `.env`

复制 `.env.example` 为 `.env`，然后改成你的 MySQL 连接：

```text
DATABASE_URL="mysql://root:password@localhost:3306/kol_crm"
```

### 3. 创建数据库

在 MySQL 里创建数据库：

```sql
CREATE DATABASE kol_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4. 创建表

```powershell
npm run db:generate
npm run db:push
```

### 5. 把 CSV 样例数据导入 MySQL

```powershell
npm run db:seed
```

完成后重新启动：

```powershell
npm run dev
```

页面就会优先读取 MySQL 数据。

## 状态更新 API

任务页的“标记已发送”和“稍后跟进”按钮会调用：

```text
PATCH /api/creators/:id/status
```

请求示例：

```json
{
  "outreachStatus": "已建联",
  "action": "mark_sent",
  "content": "已发送初次建联消息"
}
```

状态会写入 MySQL 的 `Creator` 表，同时在 `OutreachLog` 表里保存一条操作记录。

达人详情页会展示“建联记录”时间线，任务页按钮生成的记录会出现在这里。

如果你刚更新到这一版，需要重新同步数据库表结构：

```powershell
npm run db:generate
npm run db:push
```

## AI 筛选与话术

达人详情页现在有“AI评估”按钮。它会调用：

```text
POST /api/creators/:id/ai-evaluate
```

如果 `.env` 里配置了 `OPENAI_API_KEY`，会调用 OpenAI Responses API；如果没有配置，会使用本地规则生成兜底结果，页面仍然可用。

`.env` 示例：

```text
OPENAI_API_KEY="你的 OpenAI API Key"
OPENAI_MODEL="gpt-5.5-mini"
```

AI 输出会包含：

- 匹配分
- 推荐动作
- 合作形式
- 风险标签
- 谈价建议
- 建联话术

注意：当前只做“生成话术 + 人工复制/确认发送”，不做自动批量私信。

如果你要保存 AI 评估记录，需要同步新的 `AiEvaluation` 表：

```powershell
npm run db:generate
npm run db:push
```

## 下一步建议

1. 做达人详情页。
2. 做 CSV 上传导入。
3. 做建联任务状态修改。
4. 接 MySQL 状态更新。
5. 接 AI 生成个性化话术。

## 抖音采集结果导入

当前已经把抖音达人池构建链路接到 CRM：

1. 先用 MediaCrawler 根据关键词搜索作品。
2. MediaCrawler 保存作品结果时会带出作者 `creator_sec_uid` 和 `creator_profile_url`。
3. 打开 `/import`，可以上传 `data/douyin/jsonl/search_contents_*.jsonl`，也可以上传 `creators_candidate.csv`。
4. 点击“导入当前内容”后，系统会按达人去重并写入 MySQL 的 `Creator` 表。
5. 如果 `work/MediaCrawler-main/data/douyin/jsonl` 里已经有最新结果，可以直接点“一键导入最新采集结果”。

后续接星图、蒲公英、小红书时，建议继续按这个模式做：每个平台一个适配器，最后统一转成 `Creator` 入库字段。
