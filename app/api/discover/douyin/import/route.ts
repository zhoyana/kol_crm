import { NextRequest, NextResponse } from "next/server";
import { importDouyinCandidates, toImportCandidate, type DouyinDiscoveryCandidate } from "@/lib/douyin-import";
import { prisma } from "@/lib/prisma";

function normalizeCampaignTaskId(value: unknown): number | null {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

async function linkCreatorsToCampaignTask(candidates: DouyinDiscoveryCandidate[], campaignTaskId: number): Promise<number> {
  const externalIds = Array.from(new Set(candidates.map((candidate) => candidate.externalId).filter(Boolean)));
  if (!externalIds.length) return 0;

  // prisma singleton from import

  try {
    const campaignTask = await prisma.campaignTask.findUnique({
      where: { id: campaignTaskId },
      select: { id: true }
    });

    if (!campaignTask) {
      throw new Error("品类任务不存在，请先重新选择任务。");
    }

    const creators = await prisma.creator.findMany({
      where: { externalId: { in: externalIds } },
      select: { id: true, externalId: true }
    });
    const candidateMap = new Map(candidates.map((candidate) => [candidate.externalId, candidate]));

    let linked = 0;
    for (const creator of creators) {
      if (!creator.externalId) continue;
      const candidate = candidateMap.get(creator.externalId);
      await prisma.creatorCampaignTask.upsert({
        where: {
          creatorId_campaignTaskId: {
            creatorId: creator.id,
            campaignTaskId
          }
        },
        update: {
          poolStatus: "pending_review",
          screeningStatus: "homepage_sample_pending",
          screeningSummary: candidate?.screeningSummary || null,
          notes: candidate?.notes || null
        },
        create: {
          creatorId: creator.id,
          campaignTaskId,
          poolStatus: "pending_review",
          screeningStatus: "homepage_sample_pending",
          fitScore: 0,
          screeningSummary: candidate?.screeningSummary || null,
          notes: candidate?.notes || null
        }
      });
      linked += 1;
    }

    return linked;
  } finally {
    // prisma singleton — do not disconnect
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: "还没有配置 DATABASE_URL，请先连接 MySQL。" }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { candidates?: DouyinDiscoveryCandidate[]; campaignTaskId?: number | string | null } | null;
    const candidates = body?.candidates || [];
    const campaignTaskId = normalizeCampaignTaskId(body?.campaignTaskId);

    if (!candidates.length) {
      return NextResponse.json({ error: "请先选择要导入的候选达人。" }, { status: 400 });
    }

    const pendingReviewCandidates = candidates.map((candidate) => ({
      ...toImportCandidate(candidate),
      poolStatus: "pending_review",
      screeningStatus: "homepage_sample_pending",
      screeningSummary: `${candidate.screeningSummary || "作品聚合完成"}；等待补齐统一主页样本并执行 AI 作品画像初筛`
    }));

    const result = await importDouyinCandidates(pendingReviewCandidates);
    const campaignTaskLinked = campaignTaskId ? await linkCreatorsToCampaignTask(candidates, campaignTaskId) : 0;

    return NextResponse.json({ ...result, campaignTaskId, campaignTaskLinked });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json({ error: `建立画像队列失败：${message}` }, { status: 500 });
  }
}
