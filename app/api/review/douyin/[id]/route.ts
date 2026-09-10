import { NextRequest, NextResponse } from "next/server";
import { importDouyinCandidates, type DouyinDiscoveryCandidate, type DouyinWork } from "@/lib/douyin-import";
import { verifyDouyinHomepageCandidateFast, type HomepageReviewRules } from "@/lib/douyin-homepage";
import { agentIdFromRequest } from "@/lib/central-agent-auth";
import { withLocalAgentDevice } from "@/lib/local-agent-client";
import { prisma } from "@/lib/prisma";

function normalizeWorks(works: any[]): DouyinWork[] {
  return works.map((work) => ({
    awemeId: work.awemeId,
    title: work.title || "",
    url: work.url || "",
    publishedAt: work.publishedAt ? work.publishedAt.toISOString() : null,
    likeCount: work.likeCount || 0,
    collectCount: work.collectCount || 0,
    commentCount: work.commentCount || 0,
    shareCount: work.shareCount || 0,
    sourceKeyword: work.sourceKeyword || "",
    rawJson: typeof work.rawJson === "object" && work.rawJson ? work.rawJson : undefined
  }));
}

function toReviewCandidate(row: any): DouyinDiscoveryCandidate {
  const works = normalizeWorks(row.works || []);
  const sourceKeywords = Array.from(new Set(works.map((work) => work.sourceKeyword).filter(Boolean)));
  const totalLikes = works.reduce((sum, work) => sum + work.likeCount, 0);
  const totalCollects = works.reduce((sum, work) => sum + work.collectCount, 0);
  const totalComments = works.reduce((sum, work) => sum + work.commentCount, 0);
  const totalShares = works.reduce((sum, work) => sum + work.shareCount, 0);
  const secUid = row.profileUrl?.includes("/user/") ? row.profileUrl.split("/user/")[1]?.split("?")[0] || "" : "";

  return {
    externalId: row.externalId || `douyin-${row.id}`,
    creatorId: secUid || row.externalId || String(row.id),
    secUid,
    name: row.name,
    platform: row.platform || "抖音",
    profileUrl: row.profileUrl || null,
    category: row.category || "未分类",
    fans: row.fans || 0,
    plays: Array.isArray(row.plays) ? row.plays : [],
    quote: row.quote || null,
    outreachStatus: row.outreachStatus || "未建联",
    cooperationStatus: row.cooperationStatus || null,
    contact: row.contact || null,
    poolStatus: row.poolStatus || "pending_review",
    accountType: row.accountType || "unknown",
    rejectReason: row.rejectReason || null,
    screeningStatus: row.screeningStatus || "content_passed",
    screeningSummary: row.screeningSummary || null,
    lastPublishedAt: row.lastPublishedAt ? row.lastPublishedAt.toISOString() : null,
    avgLikes: row.avgLikes || 0,
    maxLikes: row.maxLikes || 0,
    recentWorkCount: row.recentWorkCount || 0,
    viralWorkCount: row.viralWorkCount || 0,
    notes: row.notes || null,
    works,
    sourceKeywords,
    workCount: works.length,
    totalLikes,
    totalCollects,
    totalComments,
    totalShares,
    sampleAwemeUrl: works[0]?.url || "",
    sampleTitle: works[0]?.title || "",
    hasRecentQualifiedWork: true,
    hasRecentUpdate: false,
    hasViralWork: false
  };
}

function normalizeCampaignTaskId(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function toHomepageCampaignTask(task: any): HomepageReviewRules["campaignTask"] | undefined {
  if (!task) return undefined;
  return {
    name: task.name || "",
    productName: task.productName || "",
    category: task.category || null,
    targetAudience: task.targetAudience || "",
    targetDescription: task.targetDescription || "",
    seedKeywords: Array.isArray(task.seedKeywords) ? task.seedKeywords : [],
    excludeKeywords: Array.isArray(task.excludeKeywords) ? task.excludeKeywords : [],
    productSellingPoints: Array.isArray(task.productSellingPoints) ? task.productSellingPoints : [],
    outreachTone: task.outreachTone || null,
    audienceTemplateId: task.audienceTemplateId ?? null,
    audienceTemplateSnapshot: (task as any).audienceTemplateSnapshot ?? null
  };
}

async function writeCampaignReviewResult(prisma: any, creatorId: number, campaignTaskId: number | null, result: {
  poolStatus: string;
  screeningStatus: string;
  screeningSummary?: string | null;
  notes?: string | null;
}) {
  if (!campaignTaskId) return;

  await prisma.creatorCampaignTask.upsert({
    where: {
      creatorId_campaignTaskId: {
        creatorId,
        campaignTaskId
      }
    },
    update: {
      poolStatus: result.poolStatus,
      screeningStatus: result.screeningStatus,
      screeningSummary: result.screeningSummary || null,
      notes: result.notes || null
    },
    create: {
      creatorId,
      campaignTaskId,
      poolStatus: result.poolStatus,
      screeningStatus: result.screeningStatus,
      fitScore: 0,
      screeningSummary: result.screeningSummary || null,
      notes: result.notes || null
    }
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withLocalAgentDevice(agentIdFromRequest(request), () => handlePost(request, context));
}

async function handlePost(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 DATABASE_URL，请先连接 MySQL。" }, { status: 400 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    rules?: HomepageReviewRules;
    workLimit?: number;
    allowFullRetry?: boolean;
    skipObviousMismatch?: boolean;
    campaignTaskId?: number | string | null;
  } | null;
  const numericId = Number(id);
  const campaignTaskId = normalizeCampaignTaskId(body?.campaignTaskId);
  // prisma singleton from import

  try {
    const campaignTask = campaignTaskId
      ? await prisma.campaignTask.findUnique({
          where: { id: campaignTaskId }
        })
      : null;
    const rules = { ...(body?.rules || {}), campaignTask: toHomepageCampaignTask(campaignTask) };
    const creator = await prisma.creator.findFirst({
      where: {
        OR: [{ externalId: id }, ...(Number.isInteger(numericId) ? [{ id: numericId }] : [])]
      },
      include: {
        works: {
          orderBy: { publishedAt: "desc" },
          take: 20
        }
      }
    });

    if (!creator) {
      return NextResponse.json({ error: "没有找到这个待复筛达人。" }, { status: 404 });
    }

    const result = await verifyDouyinHomepageCandidateFast(toReviewCandidate(creator), rules, {
      workLimit: body?.workLimit || 12,
      allowFullRetry: body?.allowFullRetry ?? true,
      skipObviousMismatch: body?.skipObviousMismatch ?? true
    });
    if (!result.ok) {
      await prisma.creator.update({
        where: { id: creator.id },
        data: {
          poolStatus: "skipped",
          screeningStatus: "inactive_or_failed",
          screeningSummary: result.reason
        }
      });
      await writeCampaignReviewResult(prisma, creator.id, campaignTaskId, {
        poolStatus: "skipped",
        screeningStatus: "inactive_or_failed",
        screeningSummary: result.reason
      });
      return NextResponse.json({ ok: false, skipped: true, message: result.reason });
    }

    await importDouyinCandidates([result.candidate]);
    await writeCampaignReviewResult(prisma, creator.id, campaignTaskId, {
      poolStatus: result.candidate.poolStatus,
      screeningStatus: result.candidate.screeningStatus,
      screeningSummary: result.candidate.screeningSummary,
      notes: result.candidate.notes
    });
    return NextResponse.json({
      ok: true,
      campaignTaskId,
      poolStatus: result.candidate.poolStatus,
      screeningStatus: result.candidate.screeningStatus,
      screeningSummary: result.candidate.screeningSummary
    });
  } finally {
    // prisma singleton — do not disconnect
  }
}
