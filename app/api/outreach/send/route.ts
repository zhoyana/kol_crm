import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type Body = {
  profileUrl?: string;
  message?: string;
};

function mediaCrawlerRoot(): string {
  return path.resolve(process.cwd(), "..", "MediaCrawler-main");
}

function isAllowedProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname) && url.hostname.endsWith("douyin.com");
  } catch {
    return false;
  }
}

function parseResult(stdout: string): { ok?: boolean; message?: string } {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Skip non-JSON Playwright output.
    }
  }
  return {};
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Body | null;
  const profileUrl = String(body?.profileUrl || "").trim();
  const message = String(body?.message || "").trim();

  if (!isAllowedProfileUrl(profileUrl)) {
    return NextResponse.json({ error: "只允许向抖音达人主页发起自动建联。" }, { status: 400 });
  }
  if (!message || message.length > 500) {
    return NextResponse.json({ error: "话术不能为空且不能超过500字。" }, { status: 400 });
  }

  const crawlerRoot = mediaCrawlerRoot();
  const pythonPath = path.join(crawlerRoot, ".venv", "Scripts", "python.exe");
  const scriptPath = path.join(crawlerRoot, "scripts", "send_douyin_message.py");

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonPath,
      [scriptPath, "--profile-url", profileUrl, "--message", message],
      {
        cwd: crawlerRoot,
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8"
        }
      }
    );
    const result = parseResult(stdout);
    if (!result.ok) {
      return NextResponse.json({ error: result.message || stderr.trim() || "自动建联没有成功。" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, message: result.message || "私信已发送。" });
  } catch (error: any) {
    const result = parseResult(String(error?.stdout || ""));
    return NextResponse.json(
      { error: result.message || String(error?.stderr || error?.message || "自动建联失败").trim() },
      { status: 502 }
    );
  }
}
