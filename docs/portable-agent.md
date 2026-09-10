# 达人采集助手便携版

便携包只承载员工电脑上的抖音能力：关键词采集、主页补齐、视频复访和私信发送。网页、业务规则和数据库不放入便携包。

## 生成便携包

在开发电脑的项目根目录执行：

```powershell
npm run agent:package
```

产物目录：

```text
dist/达人采集助手-portable/
├─ 达人采集助手.exe
├─ 使用说明.txt
├─ version.json
└─ app/
   ├─ local-agent/
   ├─ MediaCrawler-main/
   ├─ runtime/node/
   └─ runtime/python/
```

必须分发整个目录，不能只复制 EXE。可以把整个目录压缩成 ZIP 后交给员工。

## 员工电脑要求

- Windows 10/11 64 位。
- 已安装 Google Chrome。
- 不需要安装 Node.js、Python、uv、MediaCrawler 或项目源码。

员工解压后双击 `达人采集助手.exe`。程序启动后进入系统托盘；右键托盘图标可以查看状态、打开日志或退出。

## 可移动数据

程序目录只保存代码和内置运行时。员工数据写入：

```text
%LOCALAPPDATA%\KOLCRM\Agent
%LOCALAPPDATA%\KOLCRM\ChromeProfile
```

因此便携包可以放在任意目录，程序升级时也不会覆盖抖音登录状态和采集日志。

## 开发与发布边界

- `local-agent/runtime-paths.ts` 统一解析开发环境和便携环境路径。
- 便携环境不依赖开发电脑上的绝对路径。
- 视频复访直接使用内置 Python，不依赖员工电脑安装 `uv`。
- MatrixFlow 和小红书能力未进入本便携包。

## 中心任务通道

当前版本已经包含中心任务通道。员工在中心网页发起任务后，任务先进入中心数据库；本地 Agent 主动连接中心服务器领取任务，调用本机 Chrome 执行，再将进度和结果回传中心。

中心服务器不会通过自己的 `127.0.0.1` 访问员工电脑，员工电脑也不需要开放公网入站端口。中心服务器必须同时运行 Web 和 Worker，员工包中的 `central-agent.conf` 必须与服务器的中心网址及 Agent 通信密钥匹配。

详细运维和故障定位说明见 `deploy/README-IT-OPS.md`。
