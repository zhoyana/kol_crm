import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { restartCdpBrowser } from "@/lib/cdp-browser";
import { acquireCdpTaskLock } from "@/lib/cdp-task-lock";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

type Body = {
  creatorId?: string;
  profileUrl?: string;
  message?: string;
  taskKind?: "initial" | "followup" | "negotiate";
  suggestionId?: number;
  originalDraft?: string;
  verdict?: "adopted" | "modified" | "manual";
};

function canStartInitialOutreach(status: string): boolean {
  return ["未建联", "待发送确认", "暂无", "未联系"].some((value) => status.includes(value));
}

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

function shouldRetryAfterCdpRestart(error: unknown): boolean {
  const detail = String((error as any)?.stderr || (error as any)?.stdout || (error as any)?.message || error || "");
  return /connect_over_cdp|BrowserType\.connect_over_cdp|CDP.*(?:timeout|超时|断开|失败)|Target page, context or browser has been closed/i.test(detail);
}

async function sendWithBrowser(crawlerRoot: string, profileUrl: string, message: string) {
  const pythonPath = path.join(crawlerRoot, ".venv", "Scripts", "python.exe");
  const scriptPath = path.join(crawlerRoot, "scripts", "send_douyin_message.py");
  return execFileAsync(pythonPath, [scriptPath, "--profile-url", profileUrl, "--message", message], {
    cwd: crawlerRoot,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Body | null;
  const creatorId = String(body?.creatorId || "").trim();
  const profileUrl = String(body?.profileUrl || "").trim();
  const message = String(body?.message || "").trim();
  const taskKind = body?.taskKind || "initial";

  if (!creatorId) {
    return NextResponse.json({ error: "缺少达人标识，已停止发送以避免重复建联。" }, { status: 400 });
  }
  if (!isAllowedProfileUrl(profileUrl)) {
    return NextResponse.json({ error: "只允许向抖音达人主页发起自动建联。" }, { status: 400 });
  }
  if (!message || message.length > 500) {
    return NextResponse.json({ error: "话术不能为空且不能超过500字。" }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "数据库未配置，无法校验建联状态，已停止发送。" }, { status: 503 });
  }

  let creator: any;
  let reservedStatus = "";
  let cdpLease: Awaited<ReturnType<typeof acquireCdpTaskLock>> | null = null;
  try {
    // prisma singleton from import
    const numericId = Number(creatorId);
    creator = await prisma.creator.findFirst({
      where: {
        OR: [{ externalId: creatorId }, ...(Number.isInteger(numericId) ? [{ id: numericId }] : [])]
      }
    });
    if (!creator) {
      return NextResponse.json({ error: "没有找到达人，已停止发送。" }, { status: 404 });
    }
    if (taskKind === "initial" && !canStartInitialOutreach(creator.outreachStatus || "未建联")) {
      return NextResponse.json(
        { error: `该达人当前状态为“${creator.outreachStatus}”，已阻止重复初次建联。`, alreadyContacted: true },
        { status: 409 }
      );
    }

    reservedStatus = creator.outreachStatus || "未建联";
    const reserved = await prisma.creator.updateMany({
      where: { id: creator.id, outreachStatus: reservedStatus },
      data: { outreachStatus: "发送中" }
    });
    if (reserved.count !== 1) {
      return NextResponse.json({ error: "该达人的建联状态刚刚发生变化，已停止重复发送。" }, { status: 409 });
    }

    cdpLease = await acquireCdpTaskLock({ taskType: "outreach_send", taskId: String(creator.id), detail: creator.name, timeoutMs: 120_000 });
    const crawlerRoot = mediaCrawlerRoot();
    let retriedAfterRestart = false;
    let output: { stdout: string; stderr: string };
    try {
      output = await sendWithBrowser(crawlerRoot, profileUrl, message);
    } catch (error) {
      if (!shouldRetryAfterCdpRestart(error)) throw error;
      retriedAfterRestart = true;
      await restartCdpBrowser();
      output = await sendWithBrowser(crawlerRoot, profileUrl, message);
    }
    const { stdout, stderr } = output;
    const result = parseResult(stdout);
    if (!result.ok) {
      await prisma.creator.update({ where: { id: creator.id }, data: { outreachStatus: reservedStatus } });
      return NextResponse.json({ error: result.message || stderr.trim() || "自动建联没有成功。" }, { status: 502 });
    }

    const finalStatus = taskKind === "initial" ? "已建联" : reservedStatus;
    const now = new Date();

    // Find or create the conversation for this creator so we can attach the
    // outbound message and keep the chat history complete.
    const conversation = await prisma.outreachConversation.upsert({
      where: { creatorId: creator.id },
      create: { creatorId: creator.id, status: "waiting_reply", lastPreview: message, lastMessageAt: now, currentStage: taskKind === "initial" ? "initial_sent" : undefined },
      update: { lastPreview: message, lastMessageAt: now, status: "waiting_reply", syncError: null, ...(taskKind === "initial" ? { currentStage: "initial_sent" } : {}) }
    });

    // Write the outbound message with a content-based fingerprint so the
    // same text is never duplicated.
    const fingerprint = createHash("sha256").update(`${conversation.id}|outbound|${message}|${now.toISOString()}`).digest("hex");

    const suggestionId = body?.suggestionId && Number.isInteger(body.suggestionId) ? body.suggestionId : null;
    const originalDraft = body?.originalDraft || null;
    const verdict = body?.verdict || "manual";

    // Mark the AI suggestion as adopted if one was provided.
    if (suggestionId) {
      await prisma.outreachAiSuggestion.updateMany({ where: { id: suggestionId, conversationId: conversation.id }, data: { adopted: true } }).catch(() => undefined);
    }

    await prisma.$transaction([
      prisma.creator.update({ where: { id: creator.id }, data: { outreachStatus: finalStatus } }),
      prisma.outreachLog.create({
        data: {
          creatorId: creator.id,
          action: taskKind === "initial" ? "auto_send_initial" : `auto_send_${taskKind}`,
          content: `已通过本地浏览器自动发送建联私信。\n\n话术：${message}`,
          oldStatus: reservedStatus,
          newStatus: finalStatus
        }
      }),
      prisma.outreachMessage.create({
        data: { conversationId: conversation.id, fingerprint, direction: "outbound", content: message, sentAt: now, raw: { source: "crm_send", taskKind, sentAt: now.toISOString() } }
      }),
      prisma.outreachFeedback.create({
        data: {
          conversationId: conversation.id,
          suggestionId,
          verdict,
          originalDraft,
          finalContent: message,
          action: "sent",
          note: taskKind === "followup" ? "聊天窗口回复" : "达人建联发送"
        }
      })
    ]);
    return NextResponse.json({ ok: true, message: `${retriedAfterRestart ? "专用 Chrome 已自动恢复并重试。" : ""}${result.message || "私信已发送。"}` });
  } catch (error: any) {
    if (creator && reservedStatus) {
      await prisma.creator.updateMany({
        where: { id: creator.id, outreachStatus: "发送中" },
        data: { outreachStatus: reservedStatus }
      }).catch(() => undefined);
    }
    const result = parseResult(String(error?.stdout || ""));
    return NextResponse.json(
      { error: result.message || String(error?.stderr || error?.message || "自动建联失败").trim() },
      { status: 502 }
    );
  } finally {
    await cdpLease?.release().catch(() => undefined);
    // prisma singleton — do not disconnect
  }
}
