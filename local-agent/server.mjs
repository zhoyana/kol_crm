import { createServer } from "node:http";
import {
  continueDouyinCrawlerWithTopics,
  getDouyinCrawlerTask,
  getDouyinCrawlerTaskResult,
  startDouyinCrawlerTask,
  stopDouyinCrawlerTask
} from "./executors/douyin-discovery.ts";
import { crawlDouyinHomepages, readCachedDouyinHomepageRows } from "./executors/douyin-homepage.ts";
import { fetchDouyinVideoDetail } from "./executors/douyin-video.ts";
import { sendDouyinOutreach } from "./executors/douyin-outreach.ts";
import { fetchVideoDetailsBatch } from "./executors/video-batch.ts";
import { startCentralBridge } from "./central-bridge.mjs";
import { ensureCdpBrowser } from "../lib/cdp-browser.ts";

const host = "127.0.0.1";
const port = Number(process.env.LOCAL_AGENT_PORT || 17321);
const token = process.env.LOCAL_AGENT_TOKEN || "";
const maxBodyBytes = 1024 * 1024;

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}

function authorized(request) {
  if (!token) return true;
  return request.headers.authorization === `Bearer ${token}`;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("请求体超过 1MB 限制。");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  try {
    if (!authorized(request)) {
      json(response, 401, { error: "本地 Agent 访问密钥无效。" });
      return;
    }

    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, {
        ok: true,
        version: "0.3.0",
        pid: process.pid,
        capabilities: ["douyin-discovery", "douyin-homepage", "douyin-video-revisit", "xhs-video-revisit", "douyin-outreach"]
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/douyin/discovery/status") {
      json(response, 200, getDouyinCrawlerTask());
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/douyin/discovery/results") {
      json(response, 200, getDouyinCrawlerTaskResult());
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/douyin/discovery/start") {
      json(response, 200, startDouyinCrawlerTask(await readJson(request)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/douyin/discovery/continue") {
      const body = await readJson(request);
      json(response, 200, continueDouyinCrawlerWithTopics(Array.isArray(body.topics) ? body.topics : []));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/douyin/discovery/stop") {
      json(response, 200, stopDouyinCrawlerTask());
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/douyin/homepage/crawl") {
      json(response, 200, await crawlDouyinHomepages(await readJson(request)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/douyin/homepage/cache") {
      json(response, 200, await readCachedDouyinHomepageRows(await readJson(request)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/douyin/video/detail") {
      const body = await readJson(request);
      json(response, 200, await fetchDouyinVideoDetail(String(body.videoUrl || "")));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/video/batch") {
      json(response, 200, await fetchVideoDetailsBatch(await readJson(request)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/douyin/outreach/send") {
      json(response, 200, await sendDouyinOutreach(await readJson(request)));
      return;
    }

    json(response, 404, { error: "本地 Agent 接口不存在。" });
  } catch (error) {
    json(response, 400, { error: error instanceof Error ? error.message : "本地 Agent 执行失败。" });
  }
});

server.on("error", (error) => {
  console.error(`[local-agent] 启动失败：${error.message}`);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`[local-agent] 已启动：http://${host}:${port}`);
  console.log("[local-agent] 当前能力：抖音关键词采集、主页补齐、视频复访、私信发送");
});

if (process.env.KOL_AGENT_AUTO_OPEN_CHROME === "1") {
  void ensureCdpBrowser()
    .then((status) => {
      console.log(
        status.started
          ? `[local-agent] Chrome 已自动启动：127.0.0.1:${status.port}`
          : `[local-agent] 已复用 Chrome：127.0.0.1:${status.port}`
      );
    })
    .catch((error) => {
      console.error(
        `[local-agent] Chrome 自动启动失败：${error instanceof Error ? error.message : String(error)}`
      );
    });
}

const centralBridge = startCentralBridge();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    centralBridge.stop?.();
    server.close(() => process.exit(0));
  });
}
