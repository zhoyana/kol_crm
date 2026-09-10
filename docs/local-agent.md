# 本地 Agent 运行说明

当前员工端范围只包含抖音能力：

- 关键词作品采集
- 达人主页补齐
- 视频数据复访
- 私信发送

小红书 MatrixFlow 尚未进入本地 Agent，不应作为员工端默认能力发布。

## 本机开发启动

在项目根目录运行：

```powershell
npm run dev:local
```

该命令会同时启动：

- CRM：`http://127.0.0.1:3000`
- 本地 Agent：`http://127.0.0.1:17321`

也可以分别运行：

```powershell
npm run local-agent
npm run dev
```

## 环境变量

```text
LOCAL_AGENT_URL=http://127.0.0.1:17321
LOCAL_AGENT_PORT=17321
LOCAL_AGENT_TOKEN=
```

本地 Agent 仅监听 `127.0.0.1`，不要把17321或Chrome CDP端口暴露到公网。

## 代码边界

- `app/` 和 `lib/`：页面、数据库、去重、画像、复筛和入库规则。
- `local-agent/`：Chrome、MediaCrawler和浏览器操作。
- Web端通过 `lib/local-agent-client.ts` 调用本地 Agent。
- 采集结果通过JSON协议返回，再由中心业务代码写入MySQL；中心端不读取员工电脑的MediaCrawler目录。

## 安全约束

- 私信发送成功后，中心端才更新建联状态。
- 本地 Agent 对主页链接和消息长度进行二次校验。
- 打包员工端时必须设置 `LOCAL_AGENT_TOKEN`，并限制可调用命令，不提供任意Shell执行接口。
