import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { acquireCdpTaskLock } from "../../lib/cdp-task-lock.ts";
import { ensureCdpBrowser, isCdpBrowserAvailable, restartCdpBrowser } from "../../lib/cdp-browser.ts";
import {
  agentDataRoot,
  crawlerPythonCommand,
  crawlerRuntimePath,
  mediaCrawlerOutputRoot,
  mediaCrawlerRoot as resolveMediaCrawlerRoot,
  projectRoot as resolveProjectRoot
} from "../runtime-paths.ts";
import type {
  DouyinHomepageCacheInput,
  DouyinHomepageCrawlInput,
  DouyinHomepageRows
} from "../contracts.ts";

const HOMEPAGE_CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function projectRoot(): string {
  return resolveProjectRoot();
}

function mediaCrawlerRoot(): string {
  return resolveMediaCrawlerRoot();
}

function outputRoot(): string {
  return mediaCrawlerOutputRoot();
}

function jsonlDir(): string {
  return path.join(outputRoot(), "douyin", "jsonl");
}

function isCdpTakeoverFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /connect_over_cdp|Unable to take control of the logged-in CDP browser|CRAWLER_ZERO_CREATOR_WORKS|Page\.goto:\s*Timeout|ArgusSecurityPlugin|DataFetchError/i.test(message);
}

async function listContentFiles(): Promise<string[]> {
  try {
    const files = await Promise.all(
      (await readdir(jsonlDir()))
        .filter((name) => name.endsWith(".jsonl") && name.includes("contents"))
        .map(async (name) => {
          const filePath = path.join(jsonlDir(), name);
          return { filePath, mtimeMs: (await stat(filePath)).mtimeMs };
        })
    );
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs).map((item) => item.filePath);
  } catch {
    return [];
  }
}

async function rowsBySecUid(
  secUids: string[],
  accept: (row: Record<string, unknown>) => boolean
): Promise<Map<string, Map<string, string>>> {
  const keys = new Set(secUids.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const result = new Map(Array.from(keys, (key) => [key, new Map<string, string>()]));

  for (const filePath of await listContentFiles()) {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as Record<string, unknown>;
        const secUid = String(row.creator_sec_uid || "").trim().toLowerCase();
        if (!keys.has(secUid) || !accept(row)) continue;
        const rowKey = String(row.aweme_id || "") || `${filePath}:${result.get(secUid)?.size || 0}`;
        if (!result.get(secUid)?.has(rowKey)) result.get(secUid)?.set(rowKey, line);
      } catch {
        // Ignore a partial JSONL line written during interruption.
      }
    }
  }
  return result;
}

async function readRecentRows(secUids: string[], startedAt: number): Promise<Record<string, string>> {
  const rows = await rowsBySecUid(secUids, (row) => Number(row.last_modify_ts || 0) >= startedAt - 10_000);
  return Object.fromEntries(Array.from(rows, ([secUid, values]) => [secUid, Array.from(values.values()).join("\n")]));
}

export async function readCachedDouyinHomepageRows(input: DouyinHomepageCacheInput): Promise<DouyinHomepageRows> {
  const secUids = Array.from(new Set(input.secUids.map((value) => value.trim()).filter(Boolean)));
  const cutoff = Date.now() - HOMEPAGE_CACHE_TTL_MS;
  const rows = await rowsBySecUid(secUids, (row) => Number(row.last_modify_ts || 0) >= cutoff);
  const minWorks = Math.max(1, Number(input.minWorks) || 1);
  const usable = Array.from(rows).filter(([, values]) => {
    if (values.size < minWorks) return false;
    return Array.from(values.values()).some((line) => {
      try {
        return Number((JSON.parse(line) as Record<string, unknown>).creator_follower_count || 0) > 0;
      } catch {
        return false;
      }
    });
  });
  return {
    startedAt: 0,
    rowsBySecUid: Object.fromEntries(usable.map(([secUid, values]) => [secUid, Array.from(values.values()).join("\n")]))
  };
}

function runMediaCrawlerOnce(secUids: string[], workLimit: number): Promise<void> {
  const crawlerRoot = mediaCrawlerRoot();
  const pythonCommand = crawlerPythonCommand();
  const runnerScript = path.join(projectRoot(), "scripts", "run-mediacrawler.py");
  const creatorConcurrency = Math.min(3, Math.max(1, Number(process.env.CRAWLER_CREATOR_CONCURRENCY || 2)));
  const timeoutMs = Math.max(30_000, Number(process.env.CRAWLER_CREATOR_TIMEOUT_MS || 90_000));
  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== "VIRTUAL_ENV" && key.toLowerCase() !== "path")
  );
  const crawlerPath = crawlerRuntimePath();
  const args = [
    runnerScript,
    "--platform", "dy",
    "--lt", "qrcode",
    "--type", "creator",
    "--creator_id", secUids.join(","),
    "--crawler_max_notes_count", String(workLimit),
    "--max_concurrency_num", String(creatorConcurrency),
    "--get_comment", "false",
    "--get_sub_comment", "false",
    "--save_data_option", "jsonl"
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand, args, {
      cwd: crawlerRoot,
      windowsHide: true,
      shell: false,
      env: {
        ...inheritedEnv,
        PATH: crawlerPath,
        HTTP_PROXY: "",
        HTTPS_PROXY: "",
        ALL_PROXY: "",
        NO_PROXY: "localhost,127.0.0.1,::1",
        no_proxy: "localhost,127.0.0.1,::1",
        PLAYWRIGHT_BROWSERS_PATH: path.join(
          process.env.LOCALAPPDATA || path.dirname(agentDataRoot()),
          "ms-playwright"
        ),
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        PYTHONDONTWRITEBYTECODE: "1",
        MEDIACRAWLER_ROOT: crawlerRoot,
        MEDIACRAWLER_OUTPUT_ROOT: outputRoot(),
        KOL_CRM_KEEP_CREATOR_IDENTIFIERS: "1",
        KOL_CREATOR_CONCURRENCY: String(creatorConcurrency)
      } as unknown as NodeJS.ProcessEnv
    });
    let stderr = "";
    let settled = false;
    let unavailableChecks = 0;
    let checking = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(healthTimer);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`MediaCrawler 主页采集超时（${Math.round(timeoutMs / 1000)} 秒）`)));
    }, timeoutMs);
    const healthTimer = setInterval(async () => {
      if (settled || checking) return;
      checking = true;
      try {
        unavailableChecks = await isCdpBrowserAvailable() ? 0 : unavailableChecks + 1;
        if (unavailableChecks >= 3) {
          child.kill();
          finish(() => reject(new Error("Unable to take control of the logged-in CDP browser: port disappeared")));
        }
      } finally {
        checking = false;
      }
    }, 2_000);

    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => finish(() => code === 0
      ? resolve()
      : reject(new Error(stderr.trim() || `MediaCrawler exited with code ${code}`))));
  });
}

export async function crawlDouyinHomepages(input: DouyinHomepageCrawlInput): Promise<DouyinHomepageRows> {
  const secUids = Array.from(new Set(input.secUids.map((value) => value.trim()).filter(Boolean)));
  if (!secUids.length) throw new Error("主页采集缺少 sec_uid。");
  const workLimit = Math.min(30, Math.max(1, Number(input.workLimit) || 12));
  const maxAttempts = Math.min(2, Math.max(1, Number(input.maxAttempts) || 2));
  const startedAt = Date.now();
  const lease = await acquireCdpTaskLock({
    taskType: "homepage_portrait",
    taskId: `portrait-${startedAt}-${secUids[0]}`,
    detail: `${secUids.length} 位达人`
  });

  try {
    await ensureCdpBrowser();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await runMediaCrawlerOnce(secUids, workLimit);
        break;
      } catch (error) {
        if (attempt >= maxAttempts) throw error;
        if (isCdpTakeoverFailure(error)) await restartCdpBrowser();
        else if (!(await isCdpBrowserAvailable())) await ensureCdpBrowser();
        else throw error;
      }
    }
    return { startedAt, rowsBySecUid: await readRecentRows(secUids, startedAt) };
  } finally {
    await lease.release();
  }
}
