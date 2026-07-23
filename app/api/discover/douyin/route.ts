import { NextRequest, NextResponse } from "next/server";
import {
  applyDiscoveryFilters,
  importDouyinWorksToPool,
  searchDouyinCandidatesFromWorkPool,
  searchDouyinResultFiles,
  searchDouyinResultFilesByTask,
  type DiscoveryFilterOptions
} from "@/lib/douyin-import";
import { filterCandidatesByAiWorkTitles } from "@/lib/ai-work-title-filter";
import { getDouyinCrawlerTask } from "@/lib/crawler-tasks";

type DiscoveryStats = {
  rawCandidateCount: number;
  hiddenExistingCount: number;
  newCandidateCount: number;
};

type MiniPrismaClient = {
  creator: {
    findMany: (args: any) => Promise<Array<{ externalId: string | null; profileUrl: string | null }>>;
  };
  $disconnect: () => Promise<void>;
};

async function prepareCandidates(keyword: string, rawCandidates: Awaited<ReturnType<typeof searchDouyinResultFiles>>["candidates"], filters: DiscoveryFilterOptions) {
  const titleFiltered = filters.useAiWorkFilter ? await filterCandidatesByAiWorkTitles(keyword, rawCandidates, filters) : rawCandidates;
  const candidates = applyDiscoveryFilters(titleFiltered, keyword, {
    ...filters,
    skipTextRules: Boolean(filters.useAiWorkFilter)
  });

  if (!filters.useAiWorkFilter) return candidates;

  return candidates.map((candidate) => ({
    ...candidate,
    screeningStatus: candidate.rejectReason ? candidate.screeningStatus : "candidate_observe",
    screeningSummary: candidate.rejectReason
      ? candidate.screeningSummary
      : "内容初筛通过：LLM 已根据搜索结果视频标题判断；这里只代表样本视频，不代表达人主页整体数据，后续需要进入主页复筛。"
  }));
}

async function getPrisma(): Promise<MiniPrismaClient> {
  const prismaModule = await new Function("specifier", "return import(specifier)")("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient as new () => MiniPrismaClient;
  return new PrismaClient();
}

function normalizeKey(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function secUidFromProfileUrl(profileUrl: string | null | undefined): string {
  if (!profileUrl?.includes("/user/")) return "";
  return profileUrl.split("/user/")[1]?.split("?")[0] || "";
}

function candidateKeys(candidate: Awaited<ReturnType<typeof searchDouyinResultFiles>>["candidates"][number]): string[] {
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
  candidates: Awaited<ReturnType<typeof searchDouyinResultFiles>>["candidates"]
): Promise<{ candidates: Awaited<ReturnType<typeof searchDouyinResultFiles>>["candidates"]; stats: DiscoveryStats }> {
  const emptyStats = {
    rawCandidateCount: candidates.length,
    hiddenExistingCount: 0,
    newCandidateCount: candidates.length
  };

  if (!process.env.DATABASE_URL || !candidates.length) return { candidates, stats: emptyStats };

  const externalIds = Array.from(new Set(candidates.flatMap(candidateKeys))).filter(Boolean);
  const profileUrls = Array.from(new Set(candidates.map((candidate) => candidate.profileUrl).filter(Boolean))) as string[];
  if (!externalIds.length && !profileUrls.length) return { candidates, stats: emptyStats };

  const prisma = await getPrisma();
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
    await prisma.$disconnect();
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { keyword?: string; filters?: DiscoveryFilterOptions } | null;
    const keyword = body?.keyword?.trim() || "";
    const filters = body?.filters || {};
    const task = getDouyinCrawlerTask();
    const shouldUseTaskData =
      task.startedAt && task.keyword && task.keyword.trim().toLowerCase() === keyword.trim().toLowerCase() && task.status !== "idle";
    if (shouldUseTaskData) {
      const { candidates: rawCandidates, sourceFiles } = await searchDouyinResultFilesByTask({
        keyword,
        startedAt: task.startedAt,
        activeKeywords: task.activeKeywords
      });
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

    const { candidates: rawCandidates, sourceFiles } = await searchDouyinResultFiles(keyword);
    const candidates = await prepareCandidates(keyword, rawCandidates, filters);
    await importDouyinWorksToPool(candidates);
    const deduped = await hideExistingCreators(candidates);

    return NextResponse.json({
      keyword,
      candidates: deduped.candidates,
      sourceFiles,
      total: deduped.candidates.length,
      stats: deduped.stats,
      source: "legacy_jsonl"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `查询候选失败：${message}` }, { status: 500 });
  }
}
