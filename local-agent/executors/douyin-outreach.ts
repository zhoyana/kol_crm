import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { acquireCdpTaskLock } from "../../lib/cdp-task-lock.ts";
import { ensureCdpBrowser, restartCdpBrowser } from "../../lib/cdp-browser.ts";
import { crawlerPythonCommand, mediaCrawlerRoot, projectRoot } from "../runtime-paths.ts";

const execFileAsync = promisify(execFile);

function crawlerRoot(): string {
  return mediaCrawlerRoot();
}

function allowedProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname.endsWith("douyin.com");
  } catch {
    return false;
  }
}

function parseResult(stdout: string): { ok?: boolean; message?: string } {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* Skip Playwright logs. */ }
  }
  return {};
}

function shouldRestart(error: unknown): boolean {
  const detail = String((error as { stderr?: string; stdout?: string; message?: string })?.stderr
    || (error as { stdout?: string })?.stdout
    || (error as { message?: string })?.message
    || error
    || "");
  return /connect_over_cdp|BrowserType\.connect_over_cdp|CDP.*(?:timeout|超时|断开|失败)|Target page, context or browser has been closed/i.test(detail);
}

async function sendOnce(profileUrl: string, message: string) {
  const root = crawlerRoot();
  const pythonPath = crawlerPythonCommand();
  const scriptPath = path.join(projectRoot(), "scripts", "send-douyin-message.py");
  try {
    return await execFileAsync(pythonPath, [scriptPath, "--profile-url", profileUrl, "--message", message], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
    });
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    const result = parseResult(String(detail.stdout || ""));
    if (result.message) {
      const friendly = new Error(result.message) as Error & { stdout?: string; stderr?: string };
      friendly.stdout = detail.stdout;
      friendly.stderr = detail.stderr;
      throw friendly;
    }
    throw error;
  }
}

export async function sendDouyinOutreach(input: {
  profileUrl: string;
  message: string;
  taskId?: string;
}): Promise<{ ok: true; message: string; retriedAfterRestart: boolean }> {
  const profileUrl = String(input.profileUrl || "").trim();
  const message = String(input.message || "").trim();
  if (!allowedProfileUrl(profileUrl)) throw new Error("只允许向抖音达人主页发送私信。");
  if (!message || message.length > 500) throw new Error("话术不能为空且不能超过500字。");

  const lease = await acquireCdpTaskLock({
    taskType: "outreach_send",
    taskId: input.taskId || `outreach-${Date.now()}`,
    detail: profileUrl,
    timeoutMs: 120_000
  });
  try {
    await ensureCdpBrowser();
    let retriedAfterRestart = false;
    let output;
    try {
      output = await sendOnce(profileUrl, message);
    } catch (error) {
      if (!shouldRestart(error)) throw error;
      retriedAfterRestart = true;
      await restartCdpBrowser();
      output = await sendOnce(profileUrl, message);
    }
    const result = parseResult(output.stdout);
    if (!result.ok) throw new Error(result.message || output.stderr.trim() || "自动发送私信没有成功。");
    return { ok: true, message: result.message || "私信已发送。", retriedAfterRestart };
  } finally {
    await lease.release();
  }
}
