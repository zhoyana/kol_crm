import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureCdpBrowser } from "./cdp-browser";
import { acquireCdpTaskLock } from "./cdp-task-lock";

type DetailRow = {
  aweme_id?: string | number;
  aweme_url?: string;
  title?: string;
  desc?: string;
  creator_nickname?: string;
  nickname?: string;
  create_time?: string | number;
  liked_count?: string | number;
  comment_count?: string | number;
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
  commentCount: number;
  rawJson: DetailRow;
};

function crawlerDir() {
  return path.resolve(process.cwd(), "..", "MediaCrawler-main");
}

function validateDouyinUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请输入完整的抖音视频链接");
  }
  if (!/(^|\.)douyin\.com$/i.test(url.hostname)) throw new Error("目前仅支持抖音视频链接");
  return url.toString();
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

function readResult(startedAt: number): DetailRow | null {
  const dir = path.join(crawlerDir(), "data", "douyin", "jsonl");
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
        if (Number(row.last_modify_ts || 0) >= startedAt - 5_000) rows.push(row);
      } catch {
        // Ignore a partial final JSONL line.
      }
    }
  }
  return rows.sort((a, b) => Number(b.last_modify_ts || 0) - Number(a.last_modify_ts || 0))[0] || null;
}

export async function fetchDouyinVideoDetail(inputUrl: string): Promise<VideoDetail> {
  const videoUrl = validateDouyinUrl(inputUrl);
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
    const uvCommand = process.env.CRAWLER_UV_COMMAND || "uv";
    const args = [
      "run", "main.py", "--platform", "dy", "--lt", "qrcode", "--type", "detail",
      "--specified_id", videoUrl, "--get_comment", "false", "--get_sub_comment", "false",
      "--save_data_option", "jsonl"
    ];
    const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
    const crawlerPath = process.env.CRAWLER_PATH || process.env.PATH || process.env.Path || "";

    await new Promise<void>((resolve, reject) => {
      const child = spawn(uvCommand, args, {
        cwd: root,
        shell: false,
        windowsHide: true,
        env: { ...inheritedEnv, PATH: crawlerPath, PYTHONIOENCODING: "utf-8" } as unknown as NodeJS.ProcessEnv
      });
      void lease.setPid(child.pid ?? null);
      let logs = "";
      const append = (chunk: Buffer) => { logs = `${logs}${chunk.toString("utf8")}`.slice(-6000); };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`视频抓取失败（退出码 ${code}）${logs ? `：${logs.slice(-500)}` : ""}`)));
    });

    const row = readResult(startedAt);
    if (!row?.aweme_id) throw new Error("采集器已结束，但没有获取到视频详情；请确认链接可公开访问");
    return {
      awemeId: String(row.aweme_id),
      videoUrl: String(row.aweme_url || videoUrl),
      title: String(row.title || row.desc || ""),
      creatorName: String(row.creator_nickname || row.nickname || ""),
      publishedAt: toPublishedAt(row.create_time),
      likeCount: toCount(row.liked_count),
      commentCount: toCount(row.comment_count),
      rawJson: row
    };
  } finally {
    await lease.release();
  }
}
