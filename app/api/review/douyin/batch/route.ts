import { NextRequest, NextResponse } from "next/server";
import { importDouyinCandidates, type DouyinDiscoveryCandidate, type DouyinWork } from "@/lib/douyin-import";
import {
  applyHomepageMetricRules,
  verifyDouyinHomepageCandidatesBatch,
  type HomepageReviewRules
} from "@/lib/douyin-homepage";
import { prisma } from "@/lib/prisma";

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
  avgLikes?: number;
  maxLikes?: number;
  recentWorkCount?: number;
  viralWorkCount?: number;
  sampleWorkCount?: number;
  aiCalls?: number;
  wasFeatured?: boolean;
};

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
  return ids.map((id) => {
    if (id.startsWith("db:")) {
      const numericId = Number(id.slice(3));
      return Number.isInteger(numericId) ? { id: numericId } : { externalId: id };
    }
    return { externalId: id };
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
    mode?: "portrait" | "metrics";
  } | null;
  const ids = (body?.ids || []).map((id) => String(id).trim()).filter(Boolean).slice(0, 30);
  if (!ids.length) {
    return NextResponse.json({ error: "请选择要处理的达人。" }, { status: 400 });
  }

  // prisma singleton from import

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
      return NextResponse.json({ error: "没有找到待处理达人。" }, { status: 404 });
    }

    const candidates = rows.map(toReviewCandidate);
    const mode = body?.mode === "portrait" ? "portrait" : "metrics";

    if (mode === "metrics") {
      const metricCandidates = candidates.map((candidate) => applyHomepageMetricRules(candidate, rules));
      const results: BatchResult[] = [];
      const existingLinks = campaignTaskId
        ? await prisma.creatorCampaignTask.findMany({
            where: { campaignTaskId, creatorId: { in: rows.map((row) => row.id) } },
            select: { creatorId: true, poolStatus: true }
          })
        : [];
      const previousPoolByCreatorId = new Map(
        existingLinks.map((link) => [link.creatorId, link.poolStatus])
      );

      for (const row of rows) {
        const externalId = row.externalId || `douyin-${row.id}`;
        const candidate = metricCandidates.find((item) => item.externalId === externalId);
        if (!candidate) {
          results.push({ id: row.id, externalId, name: row.name, ok: false, error: "没有生成数据门槛结果" });
          continue;
        }
        await writeCampaignReviewResult(prisma, row.id, campaignTaskId, {
          poolStatus: candidate.poolStatus,
          screeningStatus: candidate.screeningStatus,
          screeningSummary: candidate.screeningSummary,
          notes: candidate.notes
        });
        results.push({
          id: row.id,
          externalId,
          name: row.name,
          ok: true,
          wasFeatured: previousPoolByCreatorId.get(row.id) === "featured",
          poolStatus: candidate.poolStatus,
          screeningStatus: candidate.screeningStatus,
          screeningSummary: candidate.screeningSummary || "",
          avgLikes: candidate.avgLikes,
          maxLikes: candidate.maxLikes,
          recentWorkCount: candidate.recentWorkCount,
          viralWorkCount: candidate.viralWorkCount,
          sampleWorkCount: candidate.works.length
        });
      }

      if (metricCandidates.length) await importDouyinCandidates(metricCandidates);
      return NextResponse.json({
        ok: true,
        mode,
        total: results.length,
        succeeded: results.filter((item) => item.ok).length,
        featured: results.filter((item) => item.poolStatus === "featured").length,
        candidate: results.filter((item) => item.poolStatus === "candidate").length,
        skipped: 0,
        failed: results.filter((item) => item.error).length,
        results
      });
    }

    const reviewResults = await verifyDouyinHomepageCandidatesBatch(candidates, rules, {
      workLimit: body?.workLimit || 10,
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
        results.push({ id: row.id, externalId, name: row.name, ok: false, error: "没有拿到作品画像结果" });
        continue;
      }

      if (!result.ok) {
        const dataIncomplete = /采集失败|未读取到|缺少 sec_uid|无法复筛|画像处理失败/.test(result.reason);
        const nextPoolStatus = dataIncomplete ? "pending_review" : "rejected";
        const nextScreeningStatus = dataIncomplete ? "portrait_data_incomplete" : "portrait_rejected";
        await prisma.creator.update({
          where: { id: row.id },
          data: {
            poolStatus: nextPoolStatus,
            screeningStatus: nextScreeningStatus,
            screeningSummary: result.reason,
            rejectReason: dataIncomplete ? null : result.reason
          }
        });
        await writeCampaignReviewResult(prisma, row.id, campaignTaskId, {
          poolStatus: nextPoolStatus,
          screeningStatus: nextScreeningStatus,
          screeningSummary: result.reason
        });
        results.push({
          id: row.id,
          externalId,
          name: row.name,
          ok: false,
          skipped: !dataIncomplete,
          poolStatus: nextPoolStatus,
          screeningStatus: nextScreeningStatus,
          message: result.reason,
          aiCalls: Number(result.aiCalls || 0)
        });
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
        screeningSummary: result.candidate.screeningSummary || "",
        avgLikes: result.candidate.avgLikes,
        maxLikes: result.candidate.maxLikes,
        recentWorkCount: result.candidate.recentWorkCount,
        viralWorkCount: result.candidate.viralWorkCount,
        sampleWorkCount: result.candidate.works.length,
        aiCalls: Number(result.aiCalls || 0)
      });
    }

    if (verifiedCandidates.length) {
      await importDouyinCandidates(verifiedCandidates);
    }

    return NextResponse.json({
      ok: true,
      mode,
      total: results.length,
      succeeded: results.filter((item) => item.ok).length,
      skipped: results.filter((item) => item.skipped).length,
      failed: results.filter((item) => item.error).length,
      aiCalls: results.reduce((sum, item) => sum + Number(item.aiCalls || 0), 0),
      results
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    console.error("[review/douyin/batch] 执行失败：", error);
    return NextResponse.json({ error: `主页画像批次失败：${message}` }, { status: 500 });
  } finally {
    // prisma singleton — do not disconnect
  }
}
