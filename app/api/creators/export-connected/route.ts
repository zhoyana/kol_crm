import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function parseShanghaiDay(value: string, endExclusive = false): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return null;
  return endExclusive ? new Date(date.getTime() + 24 * 60 * 60 * 1000) : date;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function shanghaiDate(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value).replace(/\//g, "-");
}

export async function GET(request: NextRequest) {
  const fromText = request.nextUrl.searchParams.get("from") || "";
  const toText = request.nextUrl.searchParams.get("to") || "";
  const campaignTaskId = Number(request.nextUrl.searchParams.get("campaignTaskId") || 0) || null;
  const from = parseShanghaiDay(fromText);
  const to = parseShanghaiDay(toText, true);

  if (!from || !to || from >= to) {
    return NextResponse.json({ error: "请选择有效的开始日期和结束日期。" }, { status: 400 });
  }

  const logs = await prisma.outreachLog.findMany({
    where: {
      createdAt: { gte: from, lt: to },
      newStatus: "已建联",
      NOT: { oldStatus: "已建联" },
      ...(campaignTaskId ? { campaignTaskId } : {})
    },
    include: {
      creator: { select: { id: true, name: true, fans: true, profileUrl: true } },
      campaignTask: { select: { id: true, name: true, category: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  const connectedCreatorIds = campaignTaskId
    ? new Set((await prisma.creatorCampaignTask.findMany({
        where: { campaignTaskId, outreachStatus: "已建联" },
        select: { creatorId: true }
      })).map((row) => row.creatorId))
    : null;

  const latestConnectionByCreator = new Map<string, (typeof logs)[number]>();
  for (const log of logs) {
    if (connectedCreatorIds && !connectedCreatorIds.has(log.creatorId)) continue;
    const key = `${log.campaignTaskId || "global"}:${log.creatorId}`;
    if (!latestConnectionByCreator.has(key)) latestConnectionByCreator.set(key, log);
  }

  const rows = Array.from(latestConnectionByCreator.values()).map((log) => [
    shanghaiDate(log.createdAt),
    log.creator.name,
    log.creator.fans,
    log.creator.profileUrl || "",
    log.campaignTask?.name || "全局达人库",
    log.campaignTask?.category || ""
  ]);
  const csv = "\uFEFF" + [["建联日期", "达人名字", "粉丝数", "主页链接", "品类任务", "品类"], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="connected-creators-${fromText}-${toText}.csv"`,
      "X-Export-Count": String(rows.length)
    }
  });
}
