import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureCdpBrowser } from "../../lib/cdp-browser.ts";
import { acquireCdpTaskLock } from "../../lib/cdp-task-lock.ts";
import {
  crawlerPythonCommand,
  crawlerRuntimePath,
  mediaCrawlerOutputRoot,
  mediaCrawlerRoot,
  projectRoot
} from "../runtime-paths.ts";

type DetailRow = {
  aweme_id?: string | number;
  aweme_url?: string;
  title?: string;
  desc?: string;
  creator_nickname?: string;
  nickname?: string;
  create_time?: string | number;
  liked_count?: string | number;
  collected_count?: string | number;
  comment_count?: string | number;
  share_count?: string | number;
  last_modify_ts?: number;
  [key: string]: unknown;
};

export type VideoDetail = {
  awemeId: string;
  videoUrl: string;
  title: string;
  creatorName: string;
  publishedAt: Date | null;
  likeCount: number;
  collectCount: number;
  commentCount: number;
  shareCount: number;
  rawJson: DetailRow;
};

function crawlerDir() {
  return mediaCrawlerRoot();
}

async function normalizeDouyinUrl(value: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请输入完整的抖音视频链接");
  }
  if (!/(^|\.)douyin\.com$/i.test(url.hostname)) throw new Error("目前仅支持抖音视频链接");
  // Business exports commonly contain a creator profile URL whose opened work
  // is identified by `modal_id`. Detail crawling requires a canonical work URL.
  const modalId = url.searchParams.get("modal_id")?.trim();
  if (modalId && /^\d{10,24}$/.test(modalId)) {
    return `https://www.douyin.com/video/${modalId}`;
  }
  // Resolve business-exported v.douyin.com links before MediaCrawler runs.
  // Otherwise a failed/slow redirect can leave no new JSONL row and the
  // previous run's recently written row may be mistaken for this video.
  if (url.hostname.toLowerCase() === "v.douyin.com") {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15_000)
    });
    url = new URL(response.url);
    if (!/(^|\.)douyin\.com$/i.test(url.hostname)) throw new Error("抖音短链接跳转结果无效");
  }
  return url.toString();
}

function expectedAwemeId(url: string): string {
  return url.match(/\/(?:video|note)\/(\d{10,24})/i)?.[1] || "";
}

function toCount(value: unknown): number {
  const count = Number(String(value ?? "0").replace(/,/g, ""));
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

function toPublishedAt(value: unknown): Date | null {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function closeExtraDouyinPages(): Promise<void> {
  try {
    const port = Number(process.env.CDP_DEBUG_PORT || 9222);
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(3_000)
    });
    if (!response.ok) return;
    const targets = await response.json() as Array<{ id?: string; type?: string; url?: string }>;
    const pages = targets.filter((target) => target.type === "page" && target.id);
    // Keep one ordinary Douyin page for the signed-in browser session and close
    // detail-run leftovers. Login state lives in the profile, not in each tab.
    const keep = pages.find((target) => target.url === "https://www.douyin.com/") || pages[0];
    await Promise.allSettled(
      pages
        .filter((target) => target.id !== keep?.id)
        .map((target) => fetch(`http://127.0.0.1:${port}/json/close/${target.id}`, {
          method: "PUT",
          signal: AbortSignal.timeout(3_000)
        }))
    );
  } catch {
    // Tab cleanup is best-effort and must never turn valid metrics into failure.
  }
}

function readResult(startedAt: number, awemeId: string): DetailRow | null {
  const dir = path.join(mediaCrawlerOutputRoot(), "douyin", "jsonl");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((name) => name.startsWith("detail_contents_") && name.endsWith(".jsonl"))
    .map((name) => path.join(dir, name))
    .filter((file) => statSync(file).mtimeMs >= startedAt - 5_000)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  const rows: DetailRow[] = [];
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as DetailRow;
        if (
          String(row.aweme_id || "") === awemeId
          && Number(row.last_modify_ts || 0) >= startedAt - 5_000
        ) rows.push(row);
      } catch {
        // Ignore a partial final JSONL line.
      }
    }
  }
  return rows.sort((a, b) => Number(b.last_modify_ts || 0) - Number(a.last_modify_ts || 0))[0] || null;
}

export async function fetchDouyinVideoDetail(inputUrl: string): Promise<VideoDetail> {
  const videoUrl = await normalizeDouyinUrl(inputUrl);
  const awemeId = expectedAwemeId(videoUrl);
  if (!awemeId) throw new Error("链接中没有可识别的抖音作品 ID");
  const root = crawlerDir();
  if (!existsSync(path.join(root, "main.py"))) throw new Error("未找到抖音采集器");

  const taskId = randomUUID();
  const lease = await acquireCdpTaskLock({
    taskType: "video_revisit",
    taskId,
    detail: videoUrl,
    timeoutMs: 30_000
  });
  const startedAt = Date.now();
  try {
    await ensureCdpBrowser();
    const pythonCommand = crawlerPythonCommand();
    const runnerScript = path.join(projectRoot(), "scripts", "run-mediacrawler.py");
    const args = [runnerScript,
      "--platform", "dy", "--lt", "qrcode", "--type", "detail",
      // Pass the numeric aweme ID. MediaCrawler's URL parser currently only
      // recognises /video/ paths, while Douyin image posts resolve to /note/.
      "--specified_id", awemeId, "--get_comment", "false", "--get_sub_comment", "false",
      "--save_data_option", "jsonl"
    ];
    const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
    const crawlerPath = crawlerRuntimePath();
    let crawlerLogs = "";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pythonCommand, args, {
        cwd: root,
        shell: false,
        windowsHide: true,
        env: {
          ...inheritedEnv,
          PATH: crawlerPath,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
          PYTHONDONTWRITEBYTECODE: "1",
          MEDIACRAWLER_ROOT: root,
          MEDIACRAWLER_OUTPUT_ROOT: mediaCrawlerOutputRoot()
        } as unknown as NodeJS.ProcessEnv
      });
      void lease.setPid(child.pid ?? null);
      let loginBlocked = false;
      const append = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        loginBlocked ||= /login-full-panel|subtree intercepts pointer events/i.test(text);
        crawlerLogs = loginBlocked
          ? "抖音登录状态无效：请在弹出的专用 Chrome 中完成登录，保持窗口打开后重新运行。"
          : `${crawlerLogs}${text}`.slice(-6000);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`视频抓取失败（退出码 ${code}）${crawlerLogs ? `：${crawlerLogs.slice(-500)}` : ""}`)));
    });

    const row = readResult(startedAt, awemeId);
    if (!row?.aweme_id) {
      if (crawlerLogs.includes(`Parsed aweme ID: ${awemeId}`)) {
        throw new Error(`抖音未返回作品 ${awemeId} 的详情；作品可能已删除、仅部分用户可见或受到平台风控限制`);
      }
      const detail = crawlerLogs.trim().slice(-500);
      throw new Error(`没有获取到作品 ${awemeId} 的视频详情${detail ? `：${detail}` : "；请确认链接可公开访问"}`);
    }
    return {
      awemeId: String(row.aweme_id),
      videoUrl: String(row.aweme_url || videoUrl),
      title: String(row.title || row.desc || ""),
      creatorName: String(row.creator_nickname || row.nickname || ""),
      publishedAt: toPublishedAt(row.create_time),
      likeCount: toCount(row.liked_count),
      collectCount: toCount(row.collected_count),
      commentCount: toCount(row.comment_count),
      shareCount: toCount(row.share_count),
      rawJson: row
    };
  } finally {
    await lease.release();
    await closeExtraDouyinPages();
  }
}
