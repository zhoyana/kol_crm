import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { acquireCdpTaskLock } from "@/lib/cdp-task-lock";
import { prisma } from "./prisma";

const execFileAsync = promisify(execFile);

type InboxItem = { name?: string; preview?: string; timeText?: string; unreadCount?: number };
type InboxMessage = { content?: string; direction?: "inbound" | "outbound" | "unknown"; timeText?: string };
type InboxResult = { ok?: boolean; message?: string; conversations?: InboxItem[]; messages?: InboxMessage[] };

function normalize(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function parseResult(stdout: string): InboxResult {
  for (const line of stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).reverse()) {
    try { return JSON.parse(line) as InboxResult; } catch { /* continue */ }
  }
  return {};
}

async function readInboxFromBrowser(args: string[] = []): Promise<InboxResult> {
  const root = path.resolve(process.cwd(), "..", "MediaCrawler-main");
  const python = path.join(root, ".venv", "Scripts", "python.exe");
  const script = path.join(root, "scripts", "read_douyin_inbox.py");
  try {
    const output = await execFileAsync(python, [script, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 90_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }
    });
    const result = parseResult(output.stdout);
    if (!result.ok) throw new Error(result.message || output.stderr || "读取抖音私信失败");
    return result;
  } catch (error: any) {
    // Python prints structured diagnostics before exiting non-zero. Preserve
    // that message instead of showing Node's unhelpful “Command failed”.
    const result = parseResult(String(error?.stdout || ""));
    if (result.message) throw new Error(result.message);
    throw error;
  }
}

export async function syncOutreachInbox() {
  // prisma singleton from import
  try {
    const creators = await prisma.creator.findMany({
      where: { outreachStatus: { contains: "已建联" }, platform: "抖音" },
      select: { id: true, name: true },
      take: 200
    }) as Array<{ id: number; name: string }>;
    const creatorByName = new Map<string, { id: number; name: string }>(creators.map((creator) => [normalize(creator.name), creator]));
    if (!creators.length) return { ok: true, scanned: 0, matched: 0, newReplies: 0, message: "暂无已建联抖音达人需要监控。" };

    const lease = await acquireCdpTaskLock({ taskType: "outreach_inbox", taskId: `inbox-${Date.now()}`, detail: "读取已建联达人回复", timeoutMs: 60_000 });
    let result: InboxResult;
    try {
      result = await readInboxFromBrowser();
    } finally { await lease.release(); }

    let matched = 0;
    let newReplies = 0;
    const now = new Date();
    for (const item of result.conversations || []) {
      const creator = creatorByName.get(normalize(item.name));
      if (!creator) continue;
      matched += 1;
      const preview = String(item.preview || "").trim();
      const unreadCount = Math.max(0, Number(item.unreadCount || 0));
      const conversation = await prisma.outreachConversation.upsert({
        where: { creatorId: creator.id },
        create: { creatorId: creator.id, status: unreadCount > 0 ? "needs_reply" : "waiting_reply", lastPreview: preview || null, lastMessageAt: now, lastInboundAt: unreadCount > 0 ? now : null, unreadCount, lastSyncedAt: now },
        update: { status: unreadCount > 0 ? "needs_reply" : undefined, lastPreview: preview || undefined, lastMessageAt: preview ? now : undefined, lastInboundAt: unreadCount > 0 ? now : undefined, unreadCount, lastSyncedAt: now, syncError: null }
      });
      if (!preview || unreadCount <= 0) continue;
      const fingerprint = createHash("sha256").update(`${creator.id}|${preview}|${item.timeText || ""}`).digest("hex");
      const existed = await prisma.outreachMessage.findUnique({ where: { fingerprint }, select: { id: true } });
      if (!existed) {
        await prisma.outreachMessage.create({ data: { conversationId: conversation.id, fingerprint, direction: "inbound", content: preview, sentAt: now, raw: { timeText: item.timeText || "", unreadCount } } });
        newReplies += 1;
      }
    }
    return { ok: true, scanned: (result.conversations || []).length, matched, newReplies, message: `已同步 ${matched} 个已建联会话，发现 ${newReplies} 条新回复。` };
  } finally { await prisma.$disconnect(); }
}

export async function getOutreachConversationDetail(conversationId: number) {
  // prisma singleton from import
  try {
    const conversation = await prisma.outreachConversation.findUnique({
      where: { id: conversationId },
      include: {
        creator: { select: { id: true, name: true, profileUrl: true } },
        messages: { orderBy: { createdAt: "asc" }, take: 80, select: { id: true, direction: true, content: true, createdAt: true, sentAt: true } },
        aiSuggestions: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, intent: true, intentLabel: true, sentiment: true, sentimentLabel: true, summary: true, suggestedAction: true, draft: true, draftReason: true, riskLevel: true, source: true, adopted: true, createdAt: true } },
        feedbacks: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, verdict: true, originalDraft: true, finalContent: true, action: true, note: true, createdAt: true } }
      }
    });
    if (!conversation) throw new Error("未找到该会话记录。");
    return conversation;
  } finally {
    // prisma singleton — do not disconnect
  }
}

export async function refreshOutreachConversationFromBrowser(conversationId: number) {
  // prisma singleton from import
  try {
    const conversation = await prisma.outreachConversation.findUnique({
      where: { id: conversationId },
      include: { creator: { select: { id: true, name: true, profileUrl: true } } }
    });
    if (!conversation) return;

    let syncError: string | null = null;
    try {
      const lease = await acquireCdpTaskLock({ taskType: "outreach_conversation", taskId: String(conversationId), detail: conversation.creator.name, timeoutMs: 60_000 });
      try {
        const result = await readInboxFromBrowser(["--conversation-name", conversation.creator.name]);
        const now = new Date();
        for (const [index, item] of (result.messages || []).entries()) {
          const content = String(item.content || "").trim();
          if (!content) continue;
          const direction = item.direction === "outbound" ? "outbound" : "inbound";
          const fingerprint = createHash("sha256").update(`${conversation.id}|${direction}|${content}|${item.timeText || ""}|${index}`).digest("hex");
          await prisma.outreachMessage.upsert({
            where: { fingerprint },
            create: { conversationId: conversation.id, fingerprint, direction, content, sentAt: now, raw: { timeText: item.timeText || "", source: "conversation_detail" } },
            update: {}
          });
        }
        await prisma.outreachConversation.update({ where: { id: conversation.id }, data: { unreadCount: 0, status: "waiting_reply", lastSyncedAt: now, syncError: null } });
      } finally { await lease.release(); }
    } catch (error) {
      syncError = error instanceof Error ? error.message : "从抖音刷新消息失败";
      try {
        await prisma.outreachConversation.update({ where: { id: conversation.id }, data: { syncError } });
      } catch { /* ignore DB update failure */ }
    }
  } finally {
    // prisma singleton — do not disconnect
  }
}

export async function getOutreachInbox(campaignTaskId?: number | null) {
  // prisma singleton from import
  try {
    const where: any = campaignTaskId ? { creator: { campaignTasks: { some: { campaignTaskId } } } } : {};
    return await prisma.outreachConversation.findMany({ where, include: { creator: { select: { id: true, name: true, profileUrl: true, outreachStatus: true } }, messages: { where: { direction: "inbound" }, orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: [{ unreadCount: "desc" }, { lastInboundAt: "desc" }] });
  } finally { await prisma.$disconnect(); }
}
