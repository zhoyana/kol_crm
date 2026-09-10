import type { LocalAgentHealth } from "../local-agent/contracts";
import { prisma } from "./prisma";
import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_LOCAL_AGENT_URL = "http://127.0.0.1:17321";
const agentContext = new AsyncLocalStorage<string>();

export function withLocalAgentDevice<T>(agentDeviceId: string | undefined, callback: () => Promise<T>): Promise<T> {
  return agentDeviceId ? agentContext.run(agentDeviceId, callback) : callback();
}

function agentBaseUrl(): string {
  return (process.env.LOCAL_AGENT_URL || DEFAULT_LOCAL_AGENT_URL).replace(/\/$/, "");
}

function requestHeaders(hasBody: boolean): HeadersInit {
  const headers: Record<string, string> = {};
  if (hasBody) headers["content-type"] = "application/json";
  if (process.env.LOCAL_AGENT_TOKEN) headers.authorization = `Bearer ${process.env.LOCAL_AGENT_TOKEN}`;
  return headers;
}

export async function localAgentRequest<T>(
  pathname: string,
  options: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number; agentDeviceId?: string } = {}
): Promise<T> {
  if (process.env.LOCAL_AGENT_MODE === "queue") {
    return queuedAgentRequest<T>(pathname, options);
  }
  const method = options.method || "GET";
  const hasBody = options.body !== undefined;
  let response: Response;

  try {
    response = await fetch(`${agentBaseUrl()}${pathname}`, {
      method,
      headers: requestHeaders(hasBody),
      body: hasBody ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs || 5_000)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`本地 Agent 未启动或无法连接（${agentBaseUrl()}）。请先运行 npm run local-agent。${detail ? ` ${detail}` : ""}`);
  }

  const payload = await response.json().catch(() => null) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(payload?.error || `本地 Agent 请求失败：HTTP ${response.status}`);
  if (!payload) throw new Error("本地 Agent 返回了空响应。");
  return payload;
}

async function queuedAgentRequest<T>(
  pathname: string,
  options: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number; agentDeviceId?: string }
): Promise<T> {
  const onlineAfter = new Date(Date.now() - 45_000);
  const requestedId = options.agentDeviceId || agentContext.getStore() || process.env.DEFAULT_LOCAL_AGENT_ID || "";
  const agent = requestedId
    ? await prisma.localAgentDevice.findFirst({ where: { id: requestedId, lastSeenAt: { gte: onlineAfter } } })
    : await prisma.localAgentDevice.findFirst({ where: { lastSeenAt: { gte: onlineAfter } }, orderBy: { lastSeenAt: "desc" } });
  if (!agent) {
    throw new Error(requestedId
      ? "所选达人采集助手不在线，请先在该员工电脑启动 EXE。"
      : "没有在线的达人采集助手，请先在员工电脑启动 EXE。"
    );
  }
  const timeoutMs = Math.max(2_000, options.timeoutMs || Number(process.env.CENTRAL_AGENT_JOB_TIMEOUT_MS || 600_000));
  const job = await prisma.localAgentJob.create({
    data: {
      agentDeviceId: agent.id,
      pathname,
      method: options.method || "GET",
      requestBody: options.body === undefined ? undefined : (options.body as any),
      timeoutMs
    }
  });
  const deadline = Date.now() + timeoutMs + 45_000;
  while (Date.now() < deadline) {
    const current = await prisma.localAgentJob.findUnique({ where: { id: job.id } });
    if (!current) throw new Error("本地 Agent 任务记录意外丢失。");
    if (current.status === "succeeded") return current.responseBody as T;
    if (current.status === "failed") throw new Error(current.error || "本地 Agent 执行失败。");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await prisma.localAgentJob.updateMany({
    where: { id: job.id, status: { in: ["queued", "running"] } },
    data: { status: "failed", error: "等待员工本地 Agent 超时。", finishedAt: new Date(), leaseExpiresAt: null }
  });
  throw new Error("等待员工本地 Agent 超时，请检查员工电脑网络和采集助手状态。");
}

export function getLocalAgentHealth(): Promise<LocalAgentHealth> {
  return localAgentRequest<LocalAgentHealth>("/health", { timeoutMs: 2_000 });
}
