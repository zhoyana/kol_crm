import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { agentDecisionFromStatus, calculateRealEvaluation } from "@/lib/real-agent-evaluation";

function taskId(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get("campaignTaskId"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(request: NextRequest) {
  const campaignTaskId = taskId(request);
  if (!campaignTaskId) return NextResponse.json({ error: "缺少推广任务 ID。" }, { status: 400 });
  const cases = await prisma.agentEvaluationCase.findMany({
    where: { campaignTaskId },
    orderBy: { caseKey: "asc" }
  });
  return NextResponse.json({ ok: true, cases, metrics: calculateRealEvaluation(cases) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { campaignTaskId?: number; sampleSize?: number; datasetVersion?: string } | null;
  const campaignTaskId = Number(body?.campaignTaskId);
  if (!Number.isInteger(campaignTaskId) || campaignTaskId <= 0) {
    return NextResponse.json({ error: "缺少推广任务 ID。" }, { status: 400 });
  }
  const sampleSize = Math.max(1, Math.min(100, Number(body?.sampleSize || 60)));
  const datasetVersion = String(body?.datasetVersion || "v1").trim().slice(0, 30) || "v1";
  const task = await prisma.campaignTask.findUnique({ where: { id: campaignTaskId } });
  if (!task) return NextResponse.json({ error: "推广任务不存在。" }, { status: 404 });

  const links = await prisma.creatorCampaignTask.findMany({
    where: { campaignTaskId },
    include: {
      creator: {
        include: {
          works: { orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }], take: 10 },
          aiEvaluations: { orderBy: { createdAt: "desc" }, take: 1 }
        }
      }
    },
    orderBy: { updatedAt: "desc" },
    take: sampleSize
  });
  if (!links.length) return NextResponse.json({ error: "当前任务还没有真实达人数据。" }, { status: 400 });

  let created = 0;
  for (const link of links) {
    const creator = link.creator;
    const evaluation = creator.aiEvaluations[0];
    const evidenceSnapshot = {
      capturedAt: new Date().toISOString(),
      campaign: {
        name: task.name,
        productName: task.productName,
        targetAudience: task.targetAudience,
        targetDescription: task.targetDescription
      },
      creator: {
        externalId: creator.externalId,
        name: creator.name,
        platform: creator.platform,
        profileUrl: creator.profileUrl,
        fans: creator.fans,
        avgLikes: creator.avgLikes,
        maxLikes: creator.maxLikes
      },
      works: creator.works.map((work) => ({
        awemeId: work.awemeId,
        title: work.title,
        url: work.url,
        publishedAt: work.publishedAt,
        likeCount: work.likeCount,
        commentCount: work.commentCount,
        collectCount: work.collectCount,
        sourceKeyword: work.sourceKeyword
      }))
    };
    const existing = await prisma.agentEvaluationCase.findUnique({
      where: { campaignTaskId_creatorId_datasetVersion: { campaignTaskId, creatorId: creator.id, datasetVersion } }
    });
    if (existing) continue;
    const sequence = await prisma.agentEvaluationCase.count({ where: { campaignTaskId, datasetVersion } });
    await prisma.agentEvaluationCase.create({
      data: {
        caseKey: `KOL-${campaignTaskId}-${datasetVersion.toUpperCase()}-${String(sequence + 1).padStart(3, "0")}`,
        datasetVersion,
        campaignTaskId,
        creatorId: creator.id,
        evidenceSnapshot,
        agentDecision: agentDecisionFromStatus(link.poolStatus, link.screeningStatus),
        agentReason: link.screeningSummary || creator.screeningSummary,
        agentModel: process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL || null,
        outreachScript: evaluation?.outreachScript || null
      }
    });
    created += 1;
  }
  const cases = await prisma.agentEvaluationCase.findMany({ where: { campaignTaskId }, orderBy: { caseKey: "asc" } });
  return NextResponse.json({ ok: true, created, total: cases.length, metrics: calculateRealEvaluation(cases) });
}
