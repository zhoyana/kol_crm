import { NextRequest, NextResponse } from "next/server";
import { generateAiOutreachScript, type AiProvider, type OutreachCampaignTask } from "@/lib/outreach-script";
import type { Creator } from "@/lib/creators";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Body = {
  creatorId?: string;
  campaignTaskId?: number | string | null;
  taskKind?: "initial" | "followup" | "negotiate";
  provider?: AiProvider;
};

function normalizeCampaignTaskId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function normalizePlays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item || 0)).filter((item) => Number.isFinite(item) && item > 0);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function buildCampaignTask(row: any): OutreachCampaignTask | null {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || "",
    productName: row.productName || "",
    category: row.category || "",
    targetAudience: row.targetAudience || "",
    targetDescription: row.targetDescription || "",
    seedKeywords: asStringArray(row.seedKeywords),
    excludeKeywords: asStringArray(row.excludeKeywords),
    productSellingPoints: asStringArray(row.productSellingPoints),
    outreachTone: row.outreachTone || ""
  };
}

function buildCreator(row: any, linkedTask?: any): Creator {
  const plays = normalizePlays(row.plays);
  const stablePlay = median(plays);
  const avgPlay = plays.length ? Math.round(plays.reduce((sum, item) => sum + item, 0) / plays.length) : 0;
  const quote = row.quote ?? null;
  const currentCpm = quote && stablePlay ? Number(((quote / stablePlay) * 1000).toFixed(1)) : null;
  const suggestedPrice = Math.round((stablePlay / 1000) * 15);
  const outreachStatus = linkedTask?.outreachStatus || row.outreachStatus || "未建联";

  return {
    id: row.externalId || String(row.id),
    campaignTaskId: linkedTask?.campaignTaskId || null,
    campaignTaskName: linkedTask?.campaignTask?.name || "",
    name: row.name,
    platform: row.platform || "抖音",
    profileUrl: row.profileUrl || "",
    fans: row.fans || 0,
    plays,
    quote,
    outreachStatus,
    cooperationStatus: row.cooperationStatus || "-",
    category: row.category || linkedTask?.campaignTask?.category || "未分类",
    contact: row.contact || "-",
    notes: linkedTask?.notes || row.notes || "",
    poolStatus: linkedTask?.poolStatus || row.poolStatus || "candidate",
    screeningStatus: linkedTask?.screeningStatus || row.screeningStatus || "",
    screeningSummary: [linkedTask?.portrait, linkedTask?.screeningSummary, row.screeningSummary].filter(Boolean).join("；"),
    avgPlay,
    stablePlay,
    currentCpm,
    suggestedPrice
  };
}

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "DATABASE_URL 未配置，暂时不能读取达人资料生成话术。" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const creatorId = body?.creatorId?.trim();
  const campaignTaskId = normalizeCampaignTaskId(body?.campaignTaskId);

  if (!creatorId) {
    return NextResponse.json({ error: "缺少 creatorId。" }, { status: 400 });
  }

  try {
    // prisma singleton from import
    const numericId = Number(creatorId);

    try {
      const creatorRow = await prisma.creator.findFirst({
        where: {
          OR: [{ externalId: creatorId }, ...(Number.isInteger(numericId) ? [{ id: numericId }] : [])]
        },
        include: {
          works: {
            orderBy: [{ likeCount: "desc" }],
            take: 8
          },
          campaignTasks: campaignTaskId
            ? {
                where: { campaignTaskId },
                include: { campaignTask: true },
                take: 1
              }
            : false
        }
      });

      if (!creatorRow) {
        return NextResponse.json({ error: "没有找到达人。" }, { status: 404 });
      }

      const linkedTask = campaignTaskId
        ? (creatorRow.campaignTasks?.[0] as (typeof creatorRow.campaignTasks)[number] & { campaignTask: any } | undefined)
        : null;
      const campaignTask = linkedTask?.campaignTask
        ? buildCampaignTask(linkedTask.campaignTask)
        : campaignTaskId
          ? buildCampaignTask(await prisma.campaignTask.findUnique({ where: { id: campaignTaskId } }))
          : null;

      const result = await generateAiOutreachScript({
        creator: buildCreator(creatorRow, linkedTask),
        taskKind: body?.taskKind || "initial",
        provider: body?.provider === "openai" ? "openai" : "default",
        campaignTask,
        works: creatorRow.works || []
      });

      if (result.source !== "ai") {
        return NextResponse.json(
          { error: `AI 个性化话术未生成：${result.error || result.reason}` },
          { status: 502 }
        );
      }

      await prisma.outreachLog.create({
        data: {
          creatorId: creatorRow.id,
          campaignTaskId,
          action: campaignTaskId ? "generate_campaign_ai_script" : "generate_ai_script",
          content: `复用画像：${result.portrait}\n\n生成建联话术：${result.script}`,
          oldStatus: linkedTask?.outreachStatus || creatorRow.outreachStatus,
          newStatus: linkedTask?.outreachStatus || creatorRow.outreachStatus
        }
      });

      return NextResponse.json(result);
    } finally {
      // prisma singleton — do not disconnect
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `生成话术失败：${message}` }, { status: 500 });
  }
}
