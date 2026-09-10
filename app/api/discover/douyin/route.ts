import { NextRequest, NextResponse } from "next/server";
import {
  applyDiscoveryFilters,
  importDouyinWorksToPool,
  parseDouyinDiscoveryCandidates,
  searchDouyinCandidatesFromWorkPool,
  type DouyinDiscoveryCandidate,
  type DiscoveryFilterOptions
} from "@/lib/douyin-import";
import { filterCandidatesByAiWorkTitles } from "@/lib/ai-work-title-filter";
import { getDouyinCrawlerTask, getDouyinCrawlerTaskResult } from "@/lib/crawler-tasks";
import { prisma } from "@/lib/prisma";

type DiscoveryStats = {
  rawCandidateCount: number;
  hiddenExistingCount: number;
  newCandidateCount: number;
};

async function prepareCandidates(keyword: string, rawCandidates: DouyinDiscoveryCandidate[], filters: DiscoveryFilterOptions) {
  const titleFiltered = filters.useAiWorkFilter ? await filterCandidatesByAiWorkTitles(keyword, rawCandidates, filters) : rawCandidates;
  const candidates = applyDiscoveryFilters(titleFiltered, keyword, {
    ...filters,
    skipTextRules: Boolean(filters.useAiWorkFilter)
  });

  if (!filters.useAiWorkFilter) return candidates;

  return candidates.map((candidate) => ({
    ...candidate,
    screeningStatus: candidate.rejectReason ? candidate.screeningStatus : "work_samples_collected",
    screeningSummary: candidate.rejectReason
      ? candidate.screeningSummary
      : "关键词作品样本已聚合；这里只代表搜索命中的作品，不代表达人主页整体画像，后续需要补齐统一主页样本并执行品类 AI 画像。"
  }));
}

function normalizeKey(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function secUidFromProfileUrl(profileUrl: string | null | undefined): string {
  if (!profileUrl?.includes("/user/")) return "";
  return profileUrl.split("/user/")[1]?.split("?")[0] || "";
}

function candidateKeys(candidate: DouyinDiscoveryCandidate): string[] {
  return [
    candidate.externalId,
    candidate.creatorId,
    candidate.secUid,
    candidate.profileUrl,
    secUidFromProfileUrl(candidate.profileUrl),
    candidate.secUid ? `douyin-${candidate.secUid}` : ""
  ]
    .map(normalizeKey)
    .filter(Boolean);
}

async function hideExistingCreators(
  candidates: DouyinDiscoveryCandidate[]
): Promise<{ candidates: DouyinDiscoveryCandidate[]; stats: DiscoveryStats }> {
  const emptyStats = {
    rawCandidateCount: candidates.length,
    hiddenExistingCount: 0,
    newCandidateCount: candidates.length
  };

  if (!process.env.DATABASE_URL || !candidates.length) return { candidates, stats: emptyStats };

  const externalIds = Array.from(new Set(candidates.flatMap(candidateKeys))).filter(Boolean);
  const profileUrls = Array.from(new Set(candidates.map((candidate) => candidate.profileUrl).filter(Boolean))) as string[];
  if (!externalIds.length && !profileUrls.length) return { candidates, stats: emptyStats };

  // prisma singleton from import
  try {
    const rows = await prisma.creator.findMany({
      where: {
        poolStatus: { in: ["pending_review", "candidate", "featured", "skipped", "rejected"] },
        OR: [
          ...(externalIds.length ? [{ externalId: { in: externalIds } }] : []),
          ...(profileUrls.length ? [{ profileUrl: { in: profileUrls } }] : [])
        ]
      },
      select: { externalId: true, profileUrl: true }
    });

    const existingKeys = new Set(
      rows
        .flatMap((row) => [row.externalId, row.profileUrl, secUidFromProfileUrl(row.profileUrl), row.profileUrl ? `douyin-${secUidFromProfileUrl(row.profileUrl)}` : ""])
        .map(normalizeKey)
        .filter(Boolean)
    );
    const nextCandidates = candidates.filter((candidate) => !candidateKeys(candidate).some((key) => existingKeys.has(key)));

    return {
      candidates: nextCandidates,
      stats: {
        rawCandidateCount: candidates.length,
        hiddenExistingCount: candidates.length - nextCandidates.length,
        newCandidateCount: nextCandidates.length
      }
    };
  } finally {
    // prisma singleton — do not disconnect
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { keyword?: string; filters?: DiscoveryFilterOptions } | null;
    const keyword = body?.keyword?.trim() || "";
    const filters = body?.filters || {};
    const task = await getDouyinCrawlerTask();
    const shouldUseTaskData =
      task.startedAt && task.keyword && task.keyword.trim().toLowerCase() === keyword.trim().toLowerCase() && task.status !== "idle";
    if (shouldUseTaskData) {
      const localResult = await getDouyinCrawlerTaskResult();
      const rawCandidates = parseDouyinDiscoveryCandidates(localResult.content, keyword);
      const sourceFiles = [`local-agent://douyin/discovery/${task.id}`];
      const candidates = await prepareCandidates(keyword, rawCandidates, filters);
      await importDouyinWorksToPool(candidates);
      const deduped = await hideExistingCreators(candidates);

      return NextResponse.json({
        keyword,
        candidates: deduped.candidates,
        sourceFiles,
        total: deduped.candidates.length,
        stats: deduped.stats,
        source: "current_task"
      });
    }

    const poolCandidates = await prepareCandidates(keyword, await searchDouyinCandidatesFromWorkPool(keyword), filters);
    const dedupedPool = await hideExistingCreators(poolCandidates);
    if (dedupedPool.candidates.length) {
      return NextResponse.json({
        keyword,
        candidates: dedupedPool.candidates,
        sourceFiles: [],
        total: dedupedPool.candidates.length,
        stats: dedupedPool.stats,
        source: "mysql_work_pool"
      });
    }

    return NextResponse.json({
      keyword,
      candidates: [],
      sourceFiles: [],
      total: 0,
      stats: { rawCandidateCount: 0, hiddenExistingCount: 0, newCandidateCount: 0 },
      source: "empty"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `查询候选失败：${message}` }, { status: 500 });
  }
}
