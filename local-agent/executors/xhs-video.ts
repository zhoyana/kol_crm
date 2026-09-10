import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensurePlatformCdpBrowser } from "../../lib/cdp-browser.ts";
import { acquireCdpTaskLock } from "../../lib/cdp-task-lock.ts";
import {
  agentDataRoot,
  crawlerPythonCommand,
  crawlerRuntimePath,
  mediaCrawlerOutputRoot,
  mediaCrawlerRoot,
  projectRoot
} from "../runtime-paths.ts";

type DetailRow = Record<string, unknown> & {
  note_id?: string;
  note_url?: string;
  title?: string;
  desc?: string;
  nickname?: string;
  time?: string | number;
  liked_count?: string | number;
  collected_count?: string | number;
  comment_count?: string | number;
  share_count?: string | number;
  last_modify_ts?: number;
};

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

async function normalizeXhsUrl(value: string): Promise<string> {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("请输入完整的小红书作品链接"); }
  if (/^(?:[^.]+\.)?xhslink\.(?:com|cn)$/i.test(url.hostname)) {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    url = new URL(response.url);
  }
  if (!/(^|\.)xiaohongshu\.com$/i.test(url.hostname)) throw new Error("当前链接不是小红书作品链接");
  if (!/\/(explore|discovery\/item)\/[0-9a-f]{24}/i.test(url.pathname)) throw new Error("链接中没有可识别的小红书作品 ID");
  return url.toString();
}

function expectedNoteId(url: string): string {
  return url.match(/\/(?:explore|discovery\/item)\/([0-9a-f]{24})/i)?.[1] || "";
}

function readResult(startedAt: number, noteId: string): DetailRow | null {
  const dir = path.join(mediaCrawlerOutputRoot(), "xhs", "jsonl");
  if (!existsSync(dir)) return null;
  const rows: DetailRow[] = [];
  const files = readdirSync(dir)
    .filter((name) => name.startsWith("detail_contents_") && name.endsWith(".jsonl"))
    .map((name) => path.join(dir, name))
    .filter((file) => statSync(file).mtimeMs >= startedAt - 5_000);
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as DetailRow;
        if (String(row.note_id || "") === noteId && Number(row.last_modify_ts || 0) >= startedAt - 5_000) rows.push(row);
      } catch { /* ignore a partially written final line */ }
    }
  }
  return rows.sort((a, b) => Number(b.last_modify_ts || 0) - Number(a.last_modify_ts || 0))[0] || null;
}

export async function fetchXhsVideoDetail(inputUrl: string) {
  const videoUrl = await normalizeXhsUrl(inputUrl);
  const noteId = expectedNoteId(videoUrl);
  const root = mediaCrawlerRoot();
  if (!existsSync(path.join(root, "main.py"))) throw new Error("未找到小红书采集器");
  const lease = await acquireCdpTaskLock({ taskType: "xhs_video_revisit", taskId: randomUUID(), detail: noteId, timeoutMs: 30_000 });
  const startedAt = Date.now();
  try {
    const port = Number(process.env.XHS_CDP_DEBUG_PORT || 9223);
    const profileDir = process.env.XHS_CDP_USER_DATA_DIR || path.join(agentDataRoot(), "chrome-profile-xhs");
    await ensurePlatformCdpBrowser({ port, userDataDir: profileDir, startUrl: "https://www.xiaohongshu.com/" });
    const runnerScript = path.join(projectRoot(), "scripts", "run-mediacrawler.py");
    const args = [runnerScript,
      "--platform", "xhs", "--lt", "qrcode", "--type", "detail",
      "--specified_id", videoUrl, "--get_comment", "no", "--get_sub_comment", "no",
      "--headless", "no", "--save_data_option", "jsonl", "--max_concurrency_num", "1"
    ];
    const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(crawlerPythonCommand(), args, {
        cwd: root,
        shell: false,
        windowsHide: true,
        env: {
          ...inheritedEnv,
          PATH: crawlerRuntimePath(),
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
          PYTHONDONTWRITEBYTECODE: "1",
          MEDIACRAWLER_ROOT: root,
          MEDIACRAWLER_OUTPUT_ROOT: mediaCrawlerOutputRoot(),
          MEDIACRAWLER_CDP_PORT: String(port),
          MEDIACRAWLER_CDP_CONNECT_EXISTING: "true"
        } as unknown as NodeJS.ProcessEnv
      });
      void lease.setPid(child.pid ?? null);
      let logs = "";
      const append = (chunk: Buffer) => { logs = `${logs}${chunk.toString("utf8")}`.slice(-10_000); };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else if (/login state result:\s*false|扫码|qr code|login/i.test(logs)) reject(new Error("小红书登录已失效，请在弹出的专用 Chrome 中扫码登录后重试"));
        else reject(new Error(`小红书作品抓取失败（退出码 ${code}）：${logs.slice(-800)}`));
      });
    });
    const row = readResult(startedAt, noteId);
    if (!row) throw new Error("采集器已结束，但没有获取到该小红书作品详情；链接令牌可能已过期或作品不可见");
    return {
      platform: "xhs",
      contentId: String(row.note_id || noteId),
      videoUrl: String(row.note_url || videoUrl),
      title: String(row.title || row.desc || ""),
      creatorName: String(row.nickname || ""),
      publishedAt: toPublishedAt(row.time),
      revisitedAt: new Date(),
      likeCount: toCount(row.liked_count),
      collectCount: toCount(row.collected_count),
      commentCount: toCount(row.comment_count),
      shareCount: toCount(row.share_count)
    };
  } finally {
    await lease.release();
  }
}
