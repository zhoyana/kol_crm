# KOL CRM 换机迁移指南

## 最优方案

代码使用私有 Git 仓库同步，业务数据使用 MySQL 导出文件迁移，密钥单独安全传输。不要直接复制整个项目目录，因为 `node_modules`、构建缓存、Python 虚拟环境和浏览器登录状态都与机器环境相关。

## 旧机器

1. 将主项目提交并推送到私有 Git 仓库。
2. 导出 MySQL 数据库 `kol`：

   ```powershell
   & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" -u root -p --routines --triggers --single-transaction kol > kol-backup.sql
   ```

3. 通过密码管理器或加密文件单独传输 `.env`，不要将它提交到 Git。
4. 单独保存 MediaCrawler 的改动。当前 `MediaCrawler-main/` 被 `.gitignore` 忽略，主项目 Git 不会带走它。长期最稳的做法是把修改后的 MediaCrawler 放到单独的私有仓库，并以 Git submodule 固定到具体提交；短期可以压缩该目录后单独传输。

## 新机器

1. 安装 Git、Node.js LTS、Python 和 MySQL 8。
2. 克隆私有主项目，并恢复 MediaCrawler 目录。
3. 将 `.env` 放到项目根目录，按新机器修改 `DATABASE_URL`、Python 和浏览器相关路径。
4. 安装与初始化：

   ```powershell
   npm.cmd ci
   npm.cmd run db:generate
   npm.cmd run db:push
   ```

5. 恢复数据库：

   ```powershell
   & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p kol < kol-backup.sql
   ```

6. 在 MediaCrawler 的 Python 环境重新安装依赖与 Playwright 浏览器，并重新登录平台账号。不要直接复制旧机器的 `.venv`。
7. 启动 Web 和 Worker，先做一次健康检查，再执行小规模采集测试。

## 哪些内容分别保存在哪里

- Git：源码、Prisma 定义、文档、可复用配置示例。
- MySQL：达人、作品、任务、运行记录、人工标注和评测结果。
- `.env`：数据库密码、模型密钥等秘密，只做安全的点对点传输。
- MediaCrawler 私有仓库：爬虫源码和本项目定制改动。
- 浏览器登录态：建议新机器重新登录，不把 Cookie 或浏览器用户目录提交到仓库。

## 会话与代码的区别

同一 Codex/ChatGPT 账号中的会话可以帮助新机器恢复上下文，但会话不会自动搬运本地源码和 MySQL 数据。真正可复现的项目状态应以 Git 提交、数据库备份、环境变量清单和本指南为准。
