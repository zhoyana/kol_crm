import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * MatrixFlow 小红书达人主页样本采集（替代 RedFox 作者作品接口）。
 * 通过 scripts/xhs-matrixflow-profile.mjs 打开真实浏览器窗口访问达人主页，
 * 返回昵称/粉丝数与近期作品，供 app/api/review/xhs/batch 的 AI 画像流程使用。
 */

export type MatrixflowXhsProfileWork = {
  awemeId: string;
  title: string;
  url: string | null;
  publishedAt: Date | null;
  likeCount: number;
  collectCount: number;
  commentCount: number;
  shareCount: number;
  rawJson: unknown;
};

export type MatrixflowXhsProfileResult = {
  ok: boolean;
  nickname: string;
  fans: number;
  works: MatrixflowXhsProfileWork[];
};

function asCount(value: unknown): number {
  const parsed = Number(String(value ?? 0).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export async function queryMatrixflowXhsAccountWorks(userid: string, limit = 10): Promise<MatrixflowXhsProfileResult> {
  const script = path.join(process.cwd(), "scripts", "xhs-matrixflow-profile.mjs");
  const outFile = path.join(process.cwd(), ".runtime", "xhs-matrixflow", `profile-${String(userid).replace(/[^\w-]/g, "_")}.json`);
  await mkdir(path.dirname(outFile), { recursive: true });

  const child = spawn(
    process.execPath,
    [script, "--userid", userid, "--limit", String(Math.max(1, Math.min(20, limit))), "--out", outFile],
    { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(Number(code ?? 1)));
  });
  if (exitCode !== 0) {
    const detail = stderr.trim().split(/\r?\n/).slice(-3).join(" ");
    throw new Error(`MatrixFlow 主页样本采集失败（exit ${exitCode}）：${detail || "未知错误"}`);
  }
  const payload = JSON.parse(await readFile(outFile, "utf8"));
  const works = (Array.isArray(payload?.works) ? payload.works : []).map((work: Record<string, unknown>) => ({
    awemeId: String(work?.awemeId || "").trim(),
    title: String(work?.title || "").trim(),
    url: String(work?.url || "").trim() || null,
    publishedAt: null,
    likeCount: asCount(work?.likeCount),
    collectCount: asCount(work?.collectCount),
    commentCount: asCount(work?.commentCount),
    shareCount: asCount(work?.shareCount),
    rawJson: work
  })).filter((work: MatrixflowXhsProfileWork) => work.awemeId);

  return {
    ok: true,
    nickname: String(payload?.nickname || "").trim(),
    fans: asCount(payload?.fans),
    works: works.slice(0, Math.max(1, Math.min(20, limit)))
  };
}
