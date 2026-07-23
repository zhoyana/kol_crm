import { NextRequest, NextResponse } from "next/server";
import { importDouyinCandidates, type DouyinDiscoveryCandidate, type DouyinWork } from "@/lib/douyin-import";
import { verifyDouyinHomepageCandidateFast, type HomepageReviewRules } from "@/lib/douyin-homepage";

type MiniPrismaClient = {
  creator: {
    findFirst: (args: Record<string, unknown>) => Promise<any | null>;
    update: (args: Record<string, unknown>) => Promise<any>;
  };
  $disconnect: () => Promise<void>;
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

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "还没有配置 DATABASE_URL，请先连接 MySQL。" }, { status: 400 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    rules?: HomepageReviewRules;
    workLimit?: number;
    allowFullRetry?: boolean;
    skipObviousMismatch?: boolean;
  } | null;
  const numericId = Number(id);
  const prisma = await getPrisma();

  try {
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

    const result = await verifyDouyinHomepageCandidateFast(toReviewCandidate(creator), body?.rules, {
      workLimit: body?.workLimit || 6,
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
      return NextResponse.json({ ok: false, skipped: true, message: result.reason });
    }

    await importDouyinCandidates([result.candidate]);
    return NextResponse.json({
      ok: true,
      poolStatus: result.candidate.poolStatus,
      screeningStatus: result.candidate.screeningStatus,
      screeningSummary: result.candidate.screeningSummary
    });
  } finally {
    await prisma.$disconnect();
  }
}
