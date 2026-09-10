import { localAgentRequest } from "./local-agent-client";
import type { DouyinHomepageRows } from "../local-agent/contracts";

const latestRows = new Map<string, { startedAt: number; content: string }>();

export async function runAgentHomepageCrawl(
  secUids: string[],
  workLimit: number,
  maxAttempts = 2
): Promise<void> {
  const result = await localAgentRequest<DouyinHomepageRows>("/v1/douyin/homepage/crawl", {
    method: "POST",
    body: { secUids, workLimit, maxAttempts },
    timeoutMs: Math.max(120_000, Number(process.env.CRAWLER_CREATOR_TIMEOUT_MS || 90_000) * maxAttempts + 30_000)
  });
  for (const [secUid, content] of Object.entries(result.rowsBySecUid)) {
    latestRows.set(secUid.toLowerCase(), { startedAt: result.startedAt, content });
  }
}

export async function readAgentRecentHomepageRow(secUid: string, startedAt: number): Promise<string> {
  const row = latestRows.get(secUid.toLowerCase());
  return row && row.startedAt >= startedAt - 10_000 ? row.content : "";
}

export async function readAgentRecentHomepageRows(
  secUids: string[],
  startedAt: number
): Promise<Map<string, string>> {
  return new Map(secUids.map((secUid) => {
    const key = secUid.toLowerCase();
    const row = latestRows.get(key);
    return [key, row && row.startedAt >= startedAt - 10_000 ? row.content : ""];
  }));
}

export async function readAgentCachedHomepageRows(secUids: string[], minWorks: number): Promise<Map<string, string>> {
  const result = await localAgentRequest<DouyinHomepageRows>("/v1/douyin/homepage/cache", {
    method: "POST",
    body: { secUids, minWorks },
    timeoutMs: 15_000
  });
  return new Map(Object.entries(result.rowsBySecUid));
}
