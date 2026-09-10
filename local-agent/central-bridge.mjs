import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadAgentId(dataRoot) {
  mkdirSync(dataRoot, { recursive: true });
  const file = path.join(dataRoot, "agent-id.txt");
  if (existsSync(file)) {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const created = randomUUID();
  writeFileSync(file, created, "utf8");
  return created;
}

async function centralRequest(baseUrl, token, pathname, body, timeoutMs = 30_000) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function executeLocalJob(job, localPort, localToken) {
  const hasBody = job.body !== null && job.body !== undefined;
  const headers = {};
  if (hasBody) headers["content-type"] = "application/json";
  if (localToken) headers.authorization = `Bearer ${localToken}`;
  const response = await fetch(`http://127.0.0.1:${localPort}${job.pathname}`, {
    method: job.method || "GET",
    headers,
    body: hasBody ? JSON.stringify(job.body) : undefined,
    signal: AbortSignal.timeout(Math.max(2_000, Number(job.timeoutMs || 600_000)))
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `本地接口返回 HTTP ${response.status}`);
  return result;
}

export function startCentralBridge() {
  const baseUrl = String(process.env.CENTRAL_APP_URL || "").replace(/\/$/, "");
  const token = String(process.env.CENTRAL_AGENT_TOKEN || "");
  if (!baseUrl || !token) {
    console.log("[central-bridge] 未配置中心地址，当前仅提供本机模式。");
    return { enabled: false };
  }
  const dataRoot = process.env.KOL_AGENT_DATA_ROOT || path.join(os.homedir(), ".kol-crm-agent");
  const agentId = loadAgentId(dataRoot);
  const name = String(process.env.CENTRAL_AGENT_NAME || os.hostname()).slice(0, 100);
  const localPort = Number(process.env.LOCAL_AGENT_PORT || 17321);
  const localToken = process.env.LOCAL_AGENT_TOKEN || "";
  const identity = {
    agentId,
    name,
    version: "0.3.0",
    capabilities: ["douyin-discovery", "douyin-homepage", "douyin-video-revisit", "xhs-video-revisit", "douyin-outreach"]
  };
  let stopped = false;
  let lastError = "";
  void (async () => {
    console.log(`[central-bridge] 正在连接中心：${baseUrl}，本机标识：${name}`);
    while (!stopped) {
      try {
        const data = await centralRequest(baseUrl, token, "/api/local-agents/jobs/claim", identity);
        lastError = "";
        if (!data.job) {
          await sleep(2_000);
          continue;
        }
        console.log(`[central-bridge] 领取任务 ${data.job.id}：${data.job.method} ${data.job.pathname}`);
        try {
          const result = await executeLocalJob(data.job, localPort, localToken);
          await centralRequest(baseUrl, token, `/api/local-agents/jobs/${data.job.id}/complete`, { agentId, ok: true, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await centralRequest(baseUrl, token, `/api/local-agents/jobs/${data.job.id}/complete`, { agentId, ok: false, error: message });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastError) console.error(`[central-bridge] 中心连接失败：${message}`);
        lastError = message;
        await sleep(5_000);
      }
    }
  })();
  return { enabled: true, agentId, stop: () => { stopped = true; } };
}
