import { NextRequest, NextResponse } from "next/server";
import { importDouyinCandidates, type DouyinDiscoveryCandidate, type DouyinWork } from "@/lib/douyin-import";
import { verifyDouyinHomepageCandidatesBatch, type HomepageReviewRules } from "@/lib/douyin-homepage";

type MiniPrismaClient = {
  creator: {
    findMany: (args: Record<string, unknown>) => Promise<any[]>;
    update: (args: Record<string, unknown>) => Promise<any>;
  };
  campaignTask: {
    findUnique: (args: Record<string, unknown>) => Promise<any | null>;
  };
  creatorCampaignTask: {
    upsert: (args: Record<string, unknown>) => Promise<any>;
  };
  $disconnect: () => Promise<void>;
};

type BatchResult = {
  id: number;
  externalId: string;
  name: string;
  ok: boolean;
  skipped?: boolean;
  poolStatus?: string;
  screeningStatus?: string;
  screeningSummary?: string;
  message?: string;
  error?: string;
};

async function getPrisma(): Promise<MiniPrismaClient> {
  const prismaModule = await new Function("specifier", "return import(specifier)")("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient as new () => MiniPrismaClient;
  return new PrismaClient();
}

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

function idFilters(ids: string[]): Record<string, unknown>[] {
  return ids.flatMap((id) => {
    const numericId = Number(id);
    return [{ externalId: id }, ...(Number.isInteger(numericId) ? [{ id: numericId }] : [])];
  });
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
    outreachTone: task.outreachTone || null
  };
}

async function writeCampaignReviewResult(prisma: MiniPrismaClient, creatorId: number, campaignTaskId: number | null, result: {
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

export async function POST(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 DATABASE_URL，请先连接 MySQL。" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    ids?: string[];
    rules?: HomepageReviewRules;
    workLimit?: number;
    allowFullRetry?: boolean;
    skipObviousMismatch?: boolean;
    campaignTaskId?: number | string | null;
  } | null;
  const ids = (body?.ids || []).map((id) => String(id).trim()).filter(Boolean).slice(0, 30);
  if (!ids.length) {
    return NextResponse.json({ error: "请选择要批量复筛的达人。" }, { status: 400 });
  }

  const prisma = await getPrisma();

  try {
    const campaignTaskId = normalizeCampaignTaskId(body?.campaignTaskId);
    const campaignTask = campaignTaskId
      ? await prisma.campaignTask.findUnique({
          where: { id: campaignTaskId }
        })
      : null;
    const rules = { ...(body?.rules || {}), campaignTask: toHomepageCampaignTask(campaignTask) };
    const rows = await prisma.creator.findMany({
      where: { OR: idFilters(ids) },
      include: {
        works: {
          orderBy: { publishedAt: "desc" },
          take: 20
        }
      }
    });

    if (!rows.length) {
      return NextResponse.json({ error: "没有找到待复筛达人。" }, { status: 404 });
    }

    const candidates = rows.map(toReviewCandidate);
    const reviewResults = await verifyDouyinHomepageCandidatesBatch(candidates, rules, {
      workLimit: body?.workLimit || 3,
      allowFullRetry: body?.allowFullRetry ?? true,
      skipObviousMismatch: body?.skipObviousMismatch ?? true
    });
    const resultMap = new Map(reviewResults.map((item) => [item.externalId, item.result]));
    const verifiedCandidates = reviewResults.filter((item) => item.result.ok).map((item) => (item.result as { ok: true; candidate: any }).candidate);
    const results: BatchResult[] = [];

    for (const row of rows) {
      const externalId = row.externalId || `douyin-${row.id}`;
      const result = resultMap.get(externalId);
      if (!result) {
        results.push({ id: row.id, externalId, name: row.name, ok: false, error: "没有拿到复筛结果" });
        continue;
      }

      if (!result.ok) {
        await prisma.creator.update({
          where: { id: row.id },
          data: {
            poolStatus: "skipped",
            screeningStatus: "inactive_or_failed",
            screeningSummary: result.reason
          }
        });
        await writeCampaignReviewResult(prisma, row.id, campaignTaskId, {
          poolStatus: "skipped",
          screeningStatus: "inactive_or_failed",
          screeningSummary: result.reason
        });
        results.push({ id: row.id, externalId, name: row.name, ok: false, skipped: true, message: result.reason });
        continue;
      }

      await writeCampaignReviewResult(prisma, row.id, campaignTaskId, {
        poolStatus: result.candidate.poolStatus,
        screeningStatus: result.candidate.screeningStatus,
        screeningSummary: result.candidate.screeningSummary,
        notes: result.candidate.notes
      });
      results.push({
        id: row.id,
        externalId,
        name: row.name,
        ok: true,
        poolStatus: result.candidate.poolStatus,
        screeningStatus: result.candidate.screeningStatus,
        screeningSummary: result.candidate.screeningSummary || ""
      });
    }

    if (verifiedCandidates.length) {
      await importDouyinCandidates(verifiedCandidates);
    }

    return NextResponse.json({
      ok: true,
      total: results.length,
      succeeded: results.filter((item) => item.ok).length,
      skipped: results.filter((item) => item.skipped).length,
      failed: results.filter((item) => item.error).length,
      results
    });
  } finally {
    await prisma.$disconnect();
  }
}
